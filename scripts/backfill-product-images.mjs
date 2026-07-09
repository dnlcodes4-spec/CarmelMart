/**
 * CarmelMart — Backfill: shrink oversized product images
 *
 * Next's image optimizer gives itself 7s to download an original from Storage.
 * Multi-megabyte originals blow that budget and render as broken images, worst
 * on /shop where twelve of them are fetched at once. This re-encodes every
 * oversized original referenced by products.images to a web-sized WebP and
 * repoints the product row at the new object.
 *
 * USAGE:
 *   node scripts/backfill-product-images.mjs --dry-run
 *   node scripts/backfill-product-images.mjs
 *   node scripts/backfill-product-images.mjs --min-bytes=500000 --delete-old
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { optimizeImage } from "../lib/images/optimize.mjs";

const BUCKET = "product-images";
const MAX_ATTEMPTS = 4;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const DELETE_OLD = args.includes("--delete-old");
const MIN_BYTES = Number(
  args.find((a) => a.startsWith("--min-bytes="))?.split("=")[1] ?? 1_000_000,
);
// These originals are megabytes each. Downloading them in parallel starves each
// transfer until Storage drops the connection, so default to one at a time.
const CONCURRENCY = Number(
  args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 1,
);

loadEnvLocal();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PUBLIC_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

async function main() {
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, images")
    .not("images", "is", null);
  if (error) throw error;

  const sizes = await fetchObjectSizes();

  // Every (product, imageIndex) pair whose object is over the threshold.
  const targets = [];
  for (const product of products) {
    if (!Array.isArray(product.images)) continue;
    product.images.forEach((url, index) => {
      const objectPath = toObjectPath(url);
      if (!objectPath) return;
      const size = sizes.get(objectPath);
      if (size === undefined || size <= MIN_BYTES) return;
      targets.push({ product, index, objectPath, size });
    });
  }

  console.log(
    `${targets.length} image(s) over ${fmt(MIN_BYTES)} across ` +
      `${new Set(targets.map((t) => t.product.id)).size} product(s)` +
      `${DRY_RUN ? "  [dry run]" : ""}`,
  );
  if (!targets.length) return;

  // products.images is a whole-array write, so group by product and apply one
  // update per row after all of its images are re-encoded.
  const byProduct = new Map();
  for (const target of targets) {
    if (!byProduct.has(target.product.id)) byProduct.set(target.product.id, []);
    byProduct.get(target.product.id).push(target);
  }

  const stats = { done: 0, failed: 0, bytesBefore: 0, bytesAfter: 0 };
  const groups = [...byProduct.values()];

  await runPool(groups, CONCURRENCY, async (group) => {
    const product = group[0].product;
    const images = [...product.images];
    const replaced = [];

    for (const target of group) {
      try {
        const result = await shrink(target);
        if (!result) continue;
        images[target.index] = result.url;
        replaced.push({ ...target, ...result });
        stats.bytesBefore += target.size;
        stats.bytesAfter += result.bytes;
        stats.done += 1;
      } catch (err) {
        stats.failed += 1;
        console.error(`  ✗ ${target.objectPath}: ${err.message}`);
      }
    }

    if (!replaced.length || DRY_RUN) return;

    const { error: updateError } = await supabase
      .from("products")
      .update({ images })
      .eq("id", product.id);

    if (updateError) {
      stats.failed += replaced.length;
      stats.done -= replaced.length;
      console.error(`  ✗ ${product.name}: row update failed — ${updateError.message}`);
      // Row still points at the originals, so bin the now-unreferenced uploads.
      await supabase.storage.from(BUCKET).remove(replaced.map((r) => r.newPath));
      return;
    }

    if (DELETE_OLD) {
      await supabase.storage.from(BUCKET).remove(replaced.map((r) => r.objectPath));
    }
  });

  console.log(
    `\n${stats.done} shrunk, ${stats.failed} failed — ` +
      `${fmt(stats.bytesBefore)} → ${fmt(stats.bytesAfter)}` +
      (stats.bytesBefore
        ? ` (${Math.round((1 - stats.bytesAfter / stats.bytesBefore) * 100)}% smaller)`
        : ""),
  );
  if (DRY_RUN) console.log("Dry run — nothing was written.");
  else if (!DELETE_OLD) console.log("Originals kept. Re-run with --delete-old to remove them.");
}

async function shrink({ product, objectPath, size }) {
  const data = await withRetry(`download ${objectPath}`, async () => {
    const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
    if (error) throw error;
    return data;
  });

  const original = Buffer.from(await data.arrayBuffer());
  const image = await optimizeImage(original, data.type || "image/jpeg");
  if (!image.optimized) return null;

  const dir = objectPath.slice(0, objectPath.lastIndexOf("/"));
  const newPath = `${dir}/${randomUUID()}.${image.extension}`;
  const bytes = image.buffer.byteLength;

  if (DRY_RUN) {
    report(product, size, bytes);
    return { url: `${PUBLIC_PREFIX}${newPath}`, newPath, bytes };
  }

  await withRetry(`upload ${newPath}`, async () => {
    const { error } = await supabase.storage.from(BUCKET).upload(newPath, image.buffer, {
      contentType: image.contentType,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
  });

  report(product, size, bytes);
  return { url: `${PUBLIC_PREFIX}${newPath}`, newPath, bytes };
}

function report(product, before, after) {
  console.log(`  ✓ ${product.name.slice(0, 40).padEnd(40)} ${fmt(before)} → ${fmt(after)}`);
}

/** Storage list() is per-directory, so walk the vendors/<id>/ tree. */
async function fetchObjectSizes() {
  const sizes = new Map();
  const { data: vendorDirs, error } = await supabase.storage
    .from(BUCKET)
    .list("vendors", { limit: 1000 });
  if (error) throw error;

  for (const dir of vendorDirs) {
    let offset = 0;
    for (;;) {
      const { data: files, error: listError } = await supabase.storage
        .from(BUCKET)
        .list(`vendors/${dir.name}`, { limit: 100, offset });
      if (listError) throw listError;
      if (!files.length) break;
      for (const file of files) {
        sizes.set(`vendors/${dir.name}/${file.name}`, file.metadata?.size ?? 0);
      }
      if (files.length < 100) break;
      offset += files.length;
    }
  }
  return sizes;
}

function toObjectPath(url) {
  return typeof url === "string" && url.startsWith(PUBLIC_PREFIX)
    ? url.slice(PUBLIC_PREFIX.length)
    : null;
}

async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw new Error(`${label} failed after ${attempt} attempts — ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]);
  });
  await Promise.all(runners);
}

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return; // fall back to the ambient environment
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const value = (match[2] ?? "").trim().replace(/^(['"])([\s\S]*)\1$/, "$2");
    process.env[match[1]] ??= value;
  }
}

function fmt(bytes) {
  if (bytes >= 1_000_000) return `${(bytes / 1_048_576).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}kB`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

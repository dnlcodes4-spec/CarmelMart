import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
// .mjs so scripts/backfill-product-images.mjs can share this exact logic.
import { optimizeImage } from "@/lib/images/optimize.mjs";
import { randomUUID } from "crypto";

const MAX_BYTES   = 5 * 1024 * 1024; // 5 MB
const ALLOWED     = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const BUCKET      = "product-images";

export async function POST(request) {
  try {
    // Auth — must be a verified vendor
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: vendor } = await supabaseAuth
      .from("vendors")
      .select("id, verification_status")
      .eq("id", user.id)
      .single();
    if (!vendor) return NextResponse.json({ error: "Vendor account not found" }, { status: 403 });
    if (vendor.verification_status !== "verified") {
      return NextResponse.json({ error: "Vendor account not verified" }, { status: 403 });
    }

    // Parse multipart form
    const form = await request.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Only JPEG, PNG, WebP, GIF, and AVIF are allowed." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File too large. Maximum size is 5 MB." }, { status: 400 });
    }

    let image;
    try {
      image = await optimizeImage(Buffer.from(bytes), file.type);
    } catch {
      return NextResponse.json({ error: "Image could not be processed. It may be corrupt." }, { status: 400 });
    }

    const path = `vendors/${user.id}/${randomUUID()}.${image.extension}`;

    const supabase = createAdminClient();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, image.buffer, {
        contentType:  image.contentType,
        cacheControl: "3600",
        upsert:       false,
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return NextResponse.json({ success: true, url: publicUrl, path });
  } catch (error) {
    console.error("[upload-image]", error);
    return NextResponse.json({ error: error.message || "Upload failed" }, { status: 500 });
  }
}

// DELETE — remove a specific image by path
export async function DELETE(request) {
  try {
    const supabaseAuth = await createClient();
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { path } = await request.json();
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    // Ensure vendor can only delete their own images
    if (!path.startsWith(`vendors/${user.id}/`)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createAdminClient();
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * lib/fastlink/webhook.js — verify inbound Fast Link webhook signatures.
 *
 * Fast Link POSTs a JSON event to each registered webhook on every status
 * transition. If a signing secret is set on the webhook, each delivery carries:
 *   - X-FastLink-Signature : HMAC-SHA256 of the RAW request body, hex-encoded
 *   - X-FastLink-Event     : the event type (also present in the body as `event`)
 *
 * Always verify against the RAW body text — never a re-serialized object, since
 * key ordering/whitespace would change the digest.
 *
 * ⚠️  SERVER ONLY.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { config } from "@/lib/config";

export const FASTLINK_SIGNATURE_HEADER = "x-fastlink-signature";
export const FASTLINK_EVENT_HEADER = "x-fastlink-event";

/**
 * Verify the HMAC-SHA256 signature of a raw webhook body.
 *
 * @param {string} rawBody    the exact request body text (do NOT JSON.parse then re-stringify)
 * @param {string} signature  value of the X-FastLink-Signature header
 * @param {string} [secret]   webhook signing secret; defaults to config.fastlink.webhookSecret
 * @returns {boolean}
 */
export function verifyFastLinkSignature(rawBody, signature, secret = config.fastlink.webhookSecret) {
  if (!secret) {
    console.error("[fastlink-webhook] FASTLINK_WEBHOOK_SECRET not set — rejecting all webhooks");
    return false;
  }
  if (!signature || typeof rawBody !== "string") return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  // Normalize a possible "sha256=" prefix and compare in constant time.
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

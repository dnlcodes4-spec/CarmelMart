/**
 * lib/config.js — Server-side environment configuration
 *
 * THE SINGLE SOURCE OF TRUTH for all environment values.
 * Reads from process.env and validates that required vars are present.
 *
 * ── ENVIRONMENT SWITCHING ────────────────────────────────────────────────────
 *
 *   npm run dev          → NODE_ENV=development → loads .env.development
 *   npm run build/start  → NODE_ENV=production  → loads .env.production
 *
 *   To test prod config while running dev locally, add to .env.local:
 *     NEXT_PUBLIC_APP_ENV=production
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *
 *   import { config } from "@/lib/config";
 *
 *   // Check environment
 *   if (config.isDev) { ... }
 *
 *   // Access a value
 *   const secret = config.flutterwave.secretKey;
 *
 * ⚠️  SERVER ONLY — do not import from client components.
 *     Non-NEXT_PUBLIC_ values are undefined on the client anyway,
 *     but importing this file in a client bundle wastes bytes.
 *     For client-side env checks, use process.env.NEXT_PUBLIC_APP_ENV directly.
 */

// ── Environment resolution ────────────────────────────────────────────────────
// NEXT_PUBLIC_APP_ENV is the canonical flag (set in .env.development / .env.production).
// Falls back to NODE_ENV so it works without the NEXT_PUBLIC_ var set.
const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? "development";
const isDev   = APP_ENV !== "production";

// ── Production validation ─────────────────────────────────────────────────────
// In production, these vars MUST be set. Any missing var throws immediately so
// the problem surfaces at first request rather than deep in a payment flow.
const REQUIRED_IN_PRODUCTION = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY",
  "FLUTTERWAVE_SECRET_KEY",
  "FLUTTERWAVE_WEBHOOK_HASH",
  // Site URL is checked separately — it may arrive as APP_URL or BASE_URL.
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "QOREID_CLIENT_ID",
  "QOREID_CLIENT_SECRET",
];

// In development, warn instead of throwing so a fresh clone still runs.
if (!isDev) {
  const missing = REQUIRED_IN_PRODUCTION.filter((k) => !process.env[k]);
  if (!process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_BASE_URL) {
    missing.push("NEXT_PUBLIC_APP_URL (or NEXT_PUBLIC_BASE_URL)");
  }
  if (missing.length > 0) {
    throw new Error(
      `[CarmelMart] Missing required production environment variables:\n\n` +
      missing.map((k) => `  ✗ ${k}`).join("\n") +
      `\n\nSet these in your hosting platform (Vercel → Settings → Environment Variables)\n` +
      `or in .env.local for local production testing.\n` +
      `See .env.example for descriptions of each variable.`
    );
  }
} else {
  // Dev: soft warnings for vars that affect core functionality
  const importantInDev = ["SUPABASE_SERVICE_ROLE_KEY", "QOREID_CLIENT_ID"];
  const missingInDev   = importantInDev.filter((k) => !process.env[k]);
  if (missingInDev.length > 0) {
    console.warn(
      `[CarmelMart] Dev warning — these vars are not set (add them to .env.local):\n` +
      missingInDev.map((k) => `  ! ${k}`).join("\n")
    );
  }
}

// ── Derived flags ─────────────────────────────────────────────────────────────
// Flutterwave test mode is detected from the secret key prefix.
// This is the authoritative way — avoids relying on a separate boolean var.
const flwSecretKey  = process.env.FLUTTERWAVE_SECRET_KEY ?? "";
const flwIsTestMode = flwSecretKey.includes("_TEST-");

// ── Exported config ───────────────────────────────────────────────────────────
export const config = {
  /** "development" | "production" */
  env:    APP_ENV,
  /** true when running npm run dev (or APP_ENV override is not "production") */
  isDev,
  /** true in production builds */
  isProd: !isDev,

  app: {
    // APP_URL and BASE_URL both mean "the site's base URL" and carry the same
    // value; different parts of the codebase reach for different names. Accept
    // either so a build never fails over a value that is already present under
    // the other name. Empty strings are treated as unset.
    url: process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000",
  },

  supabase: {
    url:            process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey:        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  flutterwave: {
    publicKey:     process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY,
    secretKey:     flwSecretKey,
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
    webhookHash:   process.env.FLUTTERWAVE_WEBHOOK_HASH,
    /**
     * true  → TEST keys, no real money moves, show "Test Mode" banners
     * false → LIVE keys, real payments
     */
    isTestMode:    flwIsTestMode,
  },

  email: {
    /**
     * true  → emails are logged to console (no SMTP needed)
     * false → emails are sent via SMTP
     *
     * Defaults to true in development, false in production.
     * Override by setting EMAIL_DRY_RUN=false in .env.local.
     */
    dryRun: process.env.EMAIL_DRY_RUN === "true" || (isDev && process.env.EMAIL_DRY_RUN !== "false"),
    from:  process.env.EMAIL_FROM  ?? "CarmelMart <support@carmelmart.store>",
    admin: process.env.ADMIN_EMAIL ?? "support@carmelmart.store",
  },

  qoreid: {
    clientId:     process.env.QOREID_CLIENT_ID  ?? "",
    clientSecret: process.env.QOREID_CLIENT_SECRET ?? "",
    baseUrl:      process.env.QOREID_BASE_URL       ?? "https://api.qoreid.com",
  },

  delivery: {
    /**
     * In-house rider delivery — the `rider` role, orders.rider_id, the /rider
     * portal and zone-based pricing.
     *
     * Fast Link is the intended replacement, but it cannot price or dispatch
     * until every vendor has a pickup address, and today every order still goes
     * out with a rider. So this defaults ON and only an exact "false" turns it
     * off; a typo'd value must never silently disable fulfilment.
     *
     * Turning it off closes the path to NEW orders. It does not touch orders
     * already assigned, and does not close the rider portal — riders finish
     * what they started. Flipping it back on is the rollback.
     */
    inHouseEnabled: process.env.DELIVERY_INHOUSE_ENABLED !== "false",
  },

  geocoding: {
    // Address → coordinates for Fast Link pickup/delivery. Provider-abstracted; Mapbox first.
    provider: process.env.GEOCODING_PROVIDER ?? "mapbox",
    // Bias/limit results to Nigeria by default (ISO 3166-1 alpha-2).
    country:  process.env.GEOCODING_COUNTRY ?? "ng",
    mapbox: {
      // Public token (pk.…) — safe on the client; lock it to our domains in the Mapbox dashboard.
      publicToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "",
      // Server token for backfill / permanent geocoding; falls back to the public token.
      token:       process.env.MAPBOX_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "",
    },
    /** true once a usable token is present. */
    get enabled() {
      return Boolean(this.mapbox.token);
    },
  },

  fastlink: {
    // Fast Link Marketplace delivery API — server-to-server auth.
    // Keys come from the portal's "Developer API" section (X-API-Key / X-API-Secret).
    baseUrl:       process.env.FASTLINK_BASE_URL ?? "https://backend.fastlink.cyparta.com",
    apiKey:        process.env.FASTLINK_API_KEY    ?? "",
    apiSecret:     process.env.FASTLINK_API_SECRET ?? "",
    // Signing secret configured on the webhook in the portal; used to verify
    // the X-FastLink-Signature (HMAC-SHA256) header on inbound webhooks.
    webhookSecret: process.env.FASTLINK_WEBHOOK_SECRET ?? "",
    // Products carry no structured weight, so shipping quotes assume this many
    // kg per item (× quantity) when asking Fast Link to price a delivery.
    defaultItemWeightKg: Number(process.env.FASTLINK_DEFAULT_ITEM_WEIGHT_KG) || 1,
    /** true once server credentials are present — lets callers no-op cleanly pre-go-live. */
    get enabled() {
      return Boolean(this.apiKey && this.apiSecret);
    },
  },
};

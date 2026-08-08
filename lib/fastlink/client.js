/**
 * lib/fastlink/client.js — Fast Link Marketplace delivery API client
 *
 * Server-to-server client for Fast Link (https://backend.fastlink.cyparta.com).
 * Every request carries the X-API-Key / X-API-Secret headers. Requests and
 * responses are JSON, scoped to our platform automatically by the credentials.
 *
 * ⚠️  SERVER ONLY — imports lib/config (service secrets). Never import from a
 *     client component.
 *
 * Usage:
 *   import { fastlink, FastLinkError } from "@/lib/fastlink/client";
 *   const order = await fastlink.createOrder({ ... });
 *
 * Docs: https://marketplace-portal.fastlink.cyparta.com/api-docs
 */

import { config } from "@/lib/config";

const DEFAULT_TIMEOUT_MS = 15_000;

/** Thrown on any non-2xx response. `.detail` holds Fast Link's error body. */
export class FastLinkError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.name = "FastLinkError";
    this.status = status ?? null;
    this.detail = detail ?? null;
  }
}

/**
 * Low-level request. Prefixes /platform-api, attaches auth headers, parses JSON,
 * and throws FastLinkError on non-2xx.
 *
 * @param {string} path   e.g. "orders/" — leading/trailing slashes normalized
 * @param {object} opts   { method, body, query, timeoutMs, signal }
 */
async function request(path, { method = "GET", body, query, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const { baseUrl, apiKey, apiSecret } = config.fastlink;

  if (!apiKey || !apiSecret) {
    throw new FastLinkError("Fast Link credentials are not configured.", { status: 0 });
  }

  const cleanPath = String(path).replace(/^\/+/, "").replace(/\/?$/, "/");
  const url = new URL(`/platform-api/${cleanPath}`, baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  // Combine caller's signal (if any) with our timeout.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const finalSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "X-API-Key": apiKey,
        "X-API-Secret": apiSecret,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: finalSignal,
    });
  } catch (err) {
    const aborted = err?.name === "AbortError" || err?.name === "TimeoutError";
    throw new FastLinkError(
      aborted ? "Fast Link request timed out." : `Fast Link request failed: ${err.message}`,
      { status: 0 },
    );
  }

  // 204/empty body → return null; otherwise parse JSON defensively.
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    // Validation errors come back as a field-keyed object; everything else as { detail }.
    const detailMsg =
      (data && typeof data === "object" && (data.detail || JSON.stringify(data))) ||
      (typeof data === "string" && data) ||
      res.statusText;
    throw new FastLinkError(`Fast Link ${method} ${cleanPath} → ${res.status}: ${detailMsg}`, {
      status: res.status,
      detail: data,
    });
  }

  return data;
}

export const fastlink = {
  request,

  // ── Merchants ──────────────────────────────────────────────────────────────
  listMerchants:      (query)          => request("merchants/", { query }),
  getMerchant:        (id)             => request(`merchants/${id}/`),
  createMerchant:     (body)          => request("merchants/", { method: "POST", body }),
  updateMerchant:     (id, body)      => request(`merchants/${id}/`, { method: "PATCH", body }),
  activateMerchant:   (id)             => request(`merchants/${id}/activate/`, { method: "POST" }),
  deactivateMerchant: (id)             => request(`merchants/${id}/deactivate/`, { method: "POST" }),

  // ── Pickup addresses ─────────────────────────────────────────────────────────
  listPickupAddresses:  (merchantId)  => request("pickup-addresses/", { query: { merchant: merchantId } }),
  createPickupAddress:  (body)        => request("pickup-addresses/", { method: "POST", body }),

  // ── Orders ───────────────────────────────────────────────────────────────────
  listOrders:  (query)                 => request("orders/", { query }),
  getOrder:    (id)                    => request(`orders/${id}/`),
  createOrder: (body)                 => request("orders/", { method: "POST", body }),
  cancelOrder: (id)                    => request(`orders/${id}/cancel/`, { method: "POST" }),
  getTracking: (id)                    => request(`orders/${id}/tracking/`),

  // ── Shipping ─────────────────────────────────────────────────────────────────
  /** { pickup: "lat,lng", destination: "lat,lng", weight?: string, items?: [{weight,quantity}] } */
  calculateShipping: (body)            => request("shipping/calculate/", { method: "POST", body }),
};

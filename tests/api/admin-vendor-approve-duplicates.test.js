/**
 * Approving a vendor should surface look-alike verified vendors so an admin can
 * catch a re-registration before it becomes a second Fast Link merchant.
 * The advisory must never interfere with the approval itself.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init) => ({ status: init?.status ?? 200, _data: data, json: async () => data }),
  },
}));

const sendVendorKYCDecision = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/email", () => ({ sendVendorKYCDecision: (...a) => sendVendorKYCDecision(...a) }));

const syncVendorToFastLink = vi.fn(async () => ({ merchantId: "1", pickupId: null }));
vi.mock("@/lib/fastlink/merchants", () => ({
  syncVendorToFastLink: (...a) => syncVendorToFastLink(...a),
  recordSyncError: vi.fn(async () => {}),
}));

let adminClient;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient }));

const { PATCH } = await import("@/app/api/admin/vendors/[id]/route");

const SUBJECT = { id: "slay-2", business_name: "Slayfits NG", phone: "+2348035640284", verification_status: "verified" };
const TWIN    = { id: "slay-1", business_name: "Slayfits.NG", phone: "08035640284",    verification_status: "verified" };
const OTHER   = { id: "solo-1", business_name: "Zenas Agrohub", phone: "08011112222",  verification_status: "verified" };

/** Supabase-ish fake covering both `.single()` and awaited-list query shapes. */
function makeAdmin(rows, { failDuplicateLookup = false } = {}) {
  return {
    from(table) {
      const f = {};
      const chain = {
        select: () => chain,
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        eq(col, val) { f[col] = val; return chain; },
        single: async () => {
          if (table === "users") {
            return f.id === "admin-1"
              ? { data: { role: "admin" }, error: null }
              : { data: { email: "vendor@example.com" }, error: null };
          }
          return { data: rows.find((r) => r.id === f.id) ?? null, error: null };
        },
        then(resolve) {
          if (failDuplicateLookup) return resolve({ data: null, error: { message: "db down" } });
          const list = rows.filter((r) =>
            f.verification_status ? r.verification_status === f.verification_status : true);
          resolve({ data: list, error: null });
        },
      };
      return chain;
    },
  };
}

const approve = (id = "slay-2") =>
  PATCH({ json: async () => ({ action: "approve" }) }, { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  adminClient = makeAdmin([SUBJECT, TWIN, OTHER]);
});

describe("PATCH /api/admin/vendors/[id] — duplicate advisory", () => {
  it("reports a verified vendor sharing the phone in another format", async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(res._data.success).toBe(true);
    expect(res._data.duplicates.map((d) => d.id)).toEqual(["slay-1"]);
    expect(res._data.duplicates[0].matchedOn).toContain("phone");
  });

  it("returns an empty list when the vendor is unique", async () => {
    const res = await approve("solo-1");
    expect(res._data.success).toBe(true);
    expect(res._data.duplicates).toEqual([]);
  });

  it("still approves when the duplicate lookup fails", async () => {
    adminClient = makeAdmin([SUBJECT, TWIN], { failDuplicateLookup: true });
    const res = await approve();
    expect(res.status).toBe(200);
    expect(res._data.success).toBe(true);
    expect(res._data.duplicates).toEqual([]);
  });

  it("does not let the advisory interfere with Fast Link provisioning or the email", async () => {
    await approve();
    expect(syncVendorToFastLink).toHaveBeenCalledTimes(1);
    expect(sendVendorKYCDecision).toHaveBeenCalledTimes(1);
    expect(sendVendorKYCDecision.mock.calls[0][0].approved).toBe(true);
  });
});

/**
 * lib/vendors/duplicates.js — advisory duplicate-vendor detection.
 *
 * Sellers who mistype their email at signup tend to register a second account
 * rather than recover the first, so the same business appears twice with
 * different logins. This surfaces the overlap at KYC approval, when an admin is
 * already looking at the vendor and can act on it.
 *
 * ADVISORY ONLY — every failure path returns [] so a lookup problem can never
 * block an approval.
 *
 * ⚠️  SERVER ONLY. Pass a service-role admin client.
 */

/**
 * Reduce a Nigerian phone number to a comparable local form.
 * "+2348149581424" / "2348149581424" / "0814 958 1424" → "08149581424"
 */
export function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("234")) return `0${digits.slice(3)}`;
  if (digits.length === 10) return `0${digits}`; // stored without the leading zero
  return digits;
}

/** Case, punctuation, emoji and spacing all vary between re-registrations. */
export function normalizeBusinessName(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * One line an admin can act on, or null when there is nothing to report.
 *
 * Deliberately says what matched — "same phone" is far more damning than "same
 * name", and the admin needs that to judge whether it is a genuine duplicate or
 * two unrelated shops that happen to share a word.
 *
 * @param {Array} duplicates output of findDuplicateVendors
 * @returns {string|null}
 */
export function describeDuplicates(duplicates) {
  const list = Array.isArray(duplicates) ? duplicates : [];
  if (list.length === 0) return null;

  const label = (d) => d.business_name?.trim() || "an unnamed vendor";
  const reasons = [...new Set(list.flatMap((d) => d.matchedOn ?? []))];
  const how = reasons.length === 2 ? "phone number and business name"
    : reasons[0] === "phone" ? "phone number"
    : reasons[0] === "name" ? "business name"
    : "details";

  if (list.length === 1) {
    return `${label(list[0])} is already verified with the same ${how}. Check this is not the same seller registering twice.`;
  }
  return `${list.length} already-verified vendors share the same ${how}: ${list.map(label).join(", ")}. Check this is not the same seller registering twice.`;
}

/**
 * Other verified vendors that look like the same business.
 *
 * @param {object} admin service-role Supabase client
 * @param {object} subject { vendorId, phone, businessName }
 * @returns {Promise<Array<{id, business_name, phone, matchedOn: string[]}>>}
 */
export async function findDuplicateVendors(admin, { vendorId, phone, businessName } = {}) {
  const targetPhone = normalizePhone(phone);
  const targetName = normalizeBusinessName(businessName);
  if (!targetPhone && !targetName) return [];

  try {
    // Normalization can't be expressed in PostgREST, so compare in memory. Fine
    // at the current vendor count; if this table grows past a few thousand rows,
    // move it behind an RPC with a normalized, indexed column.
    const { data, error } = await admin
      .from("vendors")
      .select("id, business_name, phone")
      .eq("verification_status", "verified");
    if (error || !Array.isArray(data)) return [];

    const matches = [];
    for (const row of data) {
      if (row.id === vendorId) continue;

      const matchedOn = [];
      const rowPhone = normalizePhone(row.phone);
      const rowName = normalizeBusinessName(row.business_name);
      if (targetPhone && rowPhone && rowPhone === targetPhone) matchedOn.push("phone");
      if (targetName && rowName && rowName === targetName) matchedOn.push("name");

      if (matchedOn.length > 0) {
        matches.push({ id: row.id, business_name: row.business_name, phone: row.phone, matchedOn });
      }
    }
    return matches;
  } catch {
    return [];
  }
}

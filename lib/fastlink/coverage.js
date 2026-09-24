/**
 * lib/fastlink/coverage.js — can this vendor's goods actually reach a customer?
 *
 * Fast Link is the only delivery mechanism now; the in-house riders that used
 * to absorb the gap are gone. A vendor with no Fast Link pickup point therefore
 * has no route to the customer at all.
 *
 * Fast Link will not catch this for us — asked to create an order for a merchant
 * with no pickup address it replies 201, not a validation error, and produces a
 * delivery with no collection point sitting in their admin queue. So the check
 * belongs here, before the customer is charged for a delivery nobody can make.
 *
 * ⚠️  SERVER ONLY. Pass a service-role admin client.
 */

/**
 * Vendors in the given set that cannot be dispatched.
 *
 * Deliberately fails open: if the lookup itself breaks, everyone is treated as
 * deliverable. Blocking a sale because of our own outage is worse than the risk
 * it prevents — an order that slips through can be chased by hand, a checkout
 * refused by mistake is simply lost.
 *
 * @param {object} admin service-role Supabase client
 * @param {string[]} vendorIds
 * @returns {Promise<Array<{id: string, business_name: string|null}>>}
 */
export async function undeliverableVendors(admin, vendorIds) {
  const ids = [...new Set((vendorIds ?? []).filter(Boolean))];
  if (ids.length === 0) return [];

  try {
    const { data, error } = await admin
      .from("vendors")
      .select("id, business_name, fastlink_pickup_id")
      .in("id", ids);
    if (error || !Array.isArray(data)) return [];

    return data
      .filter((v) => !v.fastlink_pickup_id)
      .map((v) => ({ id: v.id, business_name: v.business_name ?? null }));
  } catch {
    return [];
  }
}

/**
 * One sentence for the customer, or null when there is nothing to say.
 *
 * Phrased as our shortcoming rather than the seller's. These vendors have done
 * nothing wrong; we have not finished setting up their collection point.
 */
export function describeUndeliverable(vendors) {
  const list = Array.isArray(vendors) ? vendors : [];
  if (list.length === 0) return null;

  const names = list.map((v) => v.business_name?.trim() || "one of the sellers in your cart");
  const subject = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const verb = names.length === 1 ? "is" : "are";

  return `We cannot arrange delivery from ${subject} just yet — ${verb} not set up with our delivery partner. Please remove those items to continue, or check back shortly.`;
}

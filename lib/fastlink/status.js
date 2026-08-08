/**
 * lib/fastlink/status.js — map Fast Link delivery statuses to carmel-mart order statuses.
 *
 * Fast Link statuses (from the API docs "Order statuses" table):
 *   pending           — received, awaiting operations
 *   confirmed         — accepted
 *   preparing         — being prepared
 *   arrived_at_pickup — rider at merchant
 *   in_transit        — in progress
 *   out_for_delivery  — in progress
 *   delivered         — completed
 *   postponed         — delivery issue
 *   no_response       — delivery issue
 *   failed            — delivery issue
 *   cancelled         — cancelled
 *
 * carmel-mart order statuses (in use today):
 *   pending → confirmed → processing → shipped → delivered, plus cancelled / completed.
 */

/** @type {Record<string, string>} Fast Link status → carmel-mart order.status */
export const FASTLINK_TO_CARMEL_STATUS = {
  pending:           "confirmed",   // order already paid before dispatch; FL "pending" = accepted into their queue
  confirmed:         "confirmed",
  preparing:         "processing",
  arrived_at_pickup: "processing",
  in_transit:        "shipped",
  out_for_delivery:  "shipped",
  delivered:         "delivered",
  postponed:         "shipped",     // still out; surfaced as a delivery issue in the UI, not a status change
  no_response:       "shipped",
  failed:            "shipped",     // keep order active; ops/admin resolve — don't silently cancel
  cancelled:         "cancelled",
};

/** Fast Link statuses that represent an unresolved delivery problem (for alerting/UI badges). */
export const FASTLINK_ISSUE_STATUSES = new Set(["postponed", "no_response", "failed"]);

/** Terminal Fast Link statuses — no further transitions expected. */
export const FASTLINK_TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);

/**
 * Map a Fast Link status to a carmel-mart order status.
 * Returns null for unknown statuses so callers can log and skip rather than corrupt state.
 * @param {string} fastlinkStatus
 * @returns {string|null}
 */
export function toCarmelStatus(fastlinkStatus) {
  if (!fastlinkStatus) return null;
  return FASTLINK_TO_CARMEL_STATUS[String(fastlinkStatus).toLowerCase()] ?? null;
}

/** @param {string} fastlinkStatus */
export function isIssueStatus(fastlinkStatus) {
  return FASTLINK_ISSUE_STATUSES.has(String(fastlinkStatus).toLowerCase());
}

/** @param {string} fastlinkStatus */
export function isTerminalStatus(fastlinkStatus) {
  return FASTLINK_TERMINAL_STATUSES.has(String(fastlinkStatus).toLowerCase());
}

/**
 * Customer-facing copy for the three statuses that mean the delivery is in
 * trouble. All three map to carmel "shipped", so without this a stuck parcel
 * renders as an ordinary "Out for Delivery" step.
 *
 * Deliberately free of Fast Link's own vocabulary — the customer has no idea who
 * Fast Link is, and "no_response" is not a sentence.
 */
const FASTLINK_ISSUE_COPY = {
  postponed: {
    title:   "Delivery postponed",
    message: "Your delivery has been rescheduled. We'll let you know when the rider is on the way again.",
  },
  no_response: {
    title:   "We couldn't reach you",
    message: "The rider tried to contact you without success. Please keep your phone nearby — they'll try again.",
  },
  failed: {
    title:   "Delivery attempt failed",
    message: "Something went wrong with this delivery. Our team is looking into it.",
  },
};

/**
 * Describe a delivery problem for the customer.
 * @param {string} fastlinkStatus
 * @returns {{title: string, message: string}|null} null when nothing is wrong
 */
export function describeIssue(fastlinkStatus) {
  if (!fastlinkStatus) return null;
  return FASTLINK_ISSUE_COPY[String(fastlinkStatus).toLowerCase()] ?? null;
}

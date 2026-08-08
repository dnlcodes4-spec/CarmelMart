/**
 * lib/fastlink/tracking.js — build the customer-facing delivery timeline.
 *
 * Pure: no database access, no clock. The order fields and its Fast Link event
 * history are passed in, which keeps the shape of the timeline testable without
 * standing up a request.
 *
 * The five steps deliberately mirror what customers already see. Fast Link's
 * eleven states are richer, but extra granularity does not help someone whose
 * parcel is stuck — that is what the delivery block is for.
 */

import { isIssueStatus, describeIssue } from "./status";

/** The customer-facing steps. `status` is the carmel status that completes each one. */
export const TRACKING_STEPS = [
  { key: "placed",     label: "Order Placed",      status: null },
  { key: "confirmed",  label: "Payment Confirmed", status: "confirmed" },
  { key: "processing", label: "Being Packed",      status: "processing" },
  { key: "shipped",    label: "Out for Delivery",  status: "shipped" },
  { key: "delivered",  label: "Delivered",         status: "delivered" },
];

const STATUS_INDEX = {
  pending:    0,
  confirmed:  1,
  processing: 2,
  shipped:    3,
  delivered:  4,
  cancelled:  -1,
  refunded:   -1,
};

/**
 * Earliest event that reached a given carmel status.
 *
 * Earliest rather than latest matters: a delivery that goes in_transit →
 * postponed → out_for_delivery produces three events all mapping to "shipped",
 * and the step should keep the time it was first reached rather than creeping
 * forward on every setback.
 */
function firstReachedAt(events, carmelStatus) {
  let earliest = null;
  for (const e of events) {
    if (e?.carmel_status !== carmelStatus || !e?.created_at) continue;
    if (earliest === null || e.created_at < earliest) earliest = e.created_at;
  }
  return earliest;
}

/**
 * @param {object}   args
 * @param {string}   args.orderStatus     carmel order.status
 * @param {string}  [args.createdAt]      order.created_at — dates the first step
 * @param {string}  [args.fastlinkStatus] latest raw Fast Link status
 * @param {string}  [args.dispatchedAt]   order.fastlink_dispatched_at
 * @param {Array}   [args.events]         fastlink_order_events rows, any order
 * @returns {{tracking: Array, delivery: object}}
 */
export function buildTracking({
  orderStatus,
  createdAt = null,
  fastlinkStatus = null,
  dispatchedAt = null,
  events = [],
} = {}) {
  const history = Array.isArray(events) ? events : [];
  const currentIdx = STATUS_INDEX[orderStatus] ?? 0;
  const isCancelled = orderStatus === "cancelled" || orderStatus === "refunded";

  const tracking = TRACKING_STEPS.map((step, i) => ({
    label: step.label,
    done:  isCancelled ? false : i <= currentIdx,
    // The first step is dated from the order; the rest need an event to have
    // happened. No event means untimed, never a guess.
    at:    step.status === null ? createdAt : firstReachedAt(history, step.status),
  }));

  let lastUpdate = null;
  for (const e of history) {
    if (e?.created_at && (lastUpdate === null || e.created_at > lastUpdate)) lastUpdate = e.created_at;
  }

  return {
    tracking,
    delivery: {
      fastlinkStatus,
      isIssue: Boolean(fastlinkStatus) && isIssueStatus(fastlinkStatus),
      issue:   describeIssue(fastlinkStatus),
      dispatchedAt,
      lastUpdate,
    },
  };
}

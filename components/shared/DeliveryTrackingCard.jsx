"use client";

/**
 * The delivery tracking card shown on a customer's order page.
 *
 * Extracted from the order page so the preview at /test/delivery-tracking renders
 * the same component customers see. A preview that reimplements the markup drifts
 * from production and stops being evidence of anything.
 *
 * Presentational only — it renders whatever `tracking` and `delivery` it is handed.
 * Both come from buildTracking() in lib/fastlink/tracking.js.
 */

import { motion } from "framer-motion";
import { Truck, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

/**
 * "12 Aug, 14:30". Returns null for missing or unparseable input so callers can
 * omit the line — an untimed step is normal for orders with no delivery history.
 */
export function formatStepTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-NG", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * @param {object}   props
 * @param {Array}    props.tracking     steps from buildTracking: { label, done, at }
 * @param {object}  [props.delivery]    delivery block; absent on untracked orders
 * @param {string}   props.orderStatus  carmel order.status
 * @param {string}  [props.notes]       cancellation reason, when cancelled
 * @param {boolean} [props.animate]     step animation; off for previews rendering many at once
 */
export default function DeliveryTrackingCard({
  tracking = [],
  delivery = null,
  orderStatus,
  notes = null,
  animate = true,
}) {
  const isCancelled = orderStatus === "cancelled";
  const hasIssue = Boolean(delivery?.isIssue && delivery.issue);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6">
      <h2 className="font-bold text-gray-900 mb-5 flex items-center gap-2">
        <Truck className="w-5 h-5 text-primary" /> Order Tracking
      </h2>

      {isCancelled ? (
        <div className="flex items-center gap-3 text-red-600 bg-red-50 rounded-xl p-4">
          <XCircle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold text-sm">Order Cancelled</p>
            {notes && <p className="text-xs text-red-500 mt-0.5">{notes}</p>}
          </div>
        </div>
      ) : (
        <div className="relative">
          {tracking.map((step, i) => (
            <div key={i} className="flex gap-4 pb-6 last:pb-0">
              <div className="flex flex-col items-center">
                <motion.div
                  initial={animate ? { scale: 0 } : false}
                  animate={{ scale: 1 }}
                  transition={{ delay: animate ? i * 0.08 : 0 }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    step.done ? "bg-primary" : "bg-gray-200"
                  }`}
                >
                  {step.done
                    ? <CheckCircle className="w-4 h-4 text-white" />
                    : <div className="w-2 h-2 rounded-full bg-gray-400" />
                  }
                </motion.div>
                {i < tracking.length - 1 && (
                  <div className={`w-0.5 flex-1 mt-1 ${step.done ? "bg-primary/40" : "bg-gray-200"}`} />
                )}
              </div>
              <div className="pb-2 pt-1">
                <p className={`text-sm font-semibold ${step.done ? "text-gray-900" : "text-gray-400"}`}>
                  {step.label}
                </p>
                {formatStepTime(step.at) && (
                  <p className="text-xs text-gray-400 mt-0.5">{formatStepTime(step.at)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* A stalled delivery still reads as carmel "shipped", so the reassuring
          note below would otherwise contradict it. The problem banner replaces
          it rather than sitting alongside. */}
      {hasIssue ? (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5 text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-sm">{delivery.issue.title}</p>
            <p className="text-xs mt-0.5">{delivery.issue.message}</p>
            {formatStepTime(delivery.lastUpdate) && (
              <p className="text-[11px] text-amber-600 mt-1.5">
                Updated {formatStepTime(delivery.lastUpdate)}
              </p>
            )}
          </div>
        </div>
      ) : orderStatus === "shipped" ? (
        <div className="mt-4 bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-800">
          <p className="font-semibold">Out for Delivery</p>
          <p className="text-xs mt-0.5">The rider will contact you before arrival. Please confirm receipt once you get your order.</p>
        </div>
      ) : null}
    </div>
  );
}

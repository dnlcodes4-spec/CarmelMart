"use client";

/**
 * /test/delivery-tracking — a working simulator of the delivery tracking UI.
 *
 * Nothing here is reimplemented. It drives the REAL buildTracking(), the REAL
 * status mapping, and the REAL DeliveryTrackingCard, applying webhook events the
 * same way app/api/webhooks/fastlink/route.js does. So what you see is what a
 * customer gets — if this page lies, production lies the same way.
 *
 * No network, no database, no auth. Safe to open at any time.
 */

import { useState } from "react";
import { AlertCircle, Package, ChevronRight, Truck, RotateCcw, Zap } from "lucide-react";
import DeliveryTrackingCard from "@/components/shared/DeliveryTrackingCard";
import { buildTracking } from "@/lib/fastlink/tracking";
import { toCarmelStatus, isIssueStatus, TERMINAL_CARMEL_STATUSES } from "@/lib/fastlink/status";

// Fixed base time — deterministic, and no server/client hydration mismatch.
const BASE = new Date("2026-08-08T09:00:00.000Z").getTime();
const at = (step) => new Date(BASE + step * 45 * 60_000).toISOString();

const ORDER_CREATED = new Date(BASE - 20 * 60_000).toISOString();

/** The happy path, in the order Fast Link reports it. */
const LIFECYCLE = ["pending", "confirmed", "preparing", "arrived_at_pickup", "in_transit", "out_for_delivery", "delivered"];

/** Things that go wrong, plus one status we deliberately do not understand. */
const DISRUPTIONS = [
  { status: "postponed",   label: "Postponed",        tone: "amber" },
  { status: "no_response", label: "No response",      tone: "amber" },
  { status: "failed",      label: "Attempt failed",   tone: "amber" },
  { status: "cancelled",   label: "Cancelled",        tone: "red"   },
  { status: "teleported",  label: "Unknown status",   tone: "gray"  },
];

const PRESETS = [
  { name: "Just placed",        seq: [] },
  { name: "Being packed",       seq: ["pending", "confirmed", "preparing"] },
  { name: "On the way",         seq: ["pending", "confirmed", "preparing", "in_transit"] },
  { name: "Postponed",          seq: ["pending", "confirmed", "preparing", "in_transit", "postponed"] },
  { name: "Couldn't reach you", seq: ["pending", "confirmed", "in_transit", "no_response"] },
  { name: "Attempt failed",     seq: ["pending", "confirmed", "in_transit", "failed"] },
  { name: "Recovered",          seq: ["pending", "confirmed", "in_transit", "postponed", "out_for_delivery", "delivered"] },
  { name: "Delivered",          seq: LIFECYCLE },
  { name: "Cancelled",          seq: ["pending", "confirmed", "cancelled"] },
  { name: "Unknown status",     seq: ["pending", "confirmed", "in_transit", "teleported"] },
];

/**
 * Replay events exactly as the webhook receiver applies them: skip unchanged
 * statuses, never regress a terminal order, and record only real transitions.
 */
function replay(statuses) {
  let orderStatus = "confirmed";
  let fastlinkStatus = null;
  const events = [];

  statuses.forEach((fl, i) => {
    if (fl === fastlinkStatus) return; // redelivery — the receiver writes nothing
    const carmel = toCarmelStatus(fl);
    fastlinkStatus = fl;
    if (carmel && carmel !== orderStatus && !TERMINAL_CARMEL_STATUSES.has(orderStatus)) {
      orderStatus = carmel;
    }
    events.push({ fastlink_status: fl, carmel_status: carmel, created_at: at(i) });
  });

  return { orderStatus, fastlinkStatus, events };
}

function Chip({ active, onClick, children, tone = "default" }) {
  const tones = {
    default: active ? "bg-primary text-white border-primary" : "bg-white border-gray-200 text-gray-600 hover:border-primary hover:text-primary",
    amber:   "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100",
    red:     "bg-red-50 border-red-300 text-red-700 hover:bg-red-100",
    gray:    "bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100",
  };
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-2 rounded-full text-xs font-semibold border transition-colors ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export default function DeliveryTrackingTestPage() {
  const [sent, setSent] = useState([]);
  const [preset, setPreset] = useState("Just placed");

  const { orderStatus, fastlinkStatus, events } = replay(sent);
  const { tracking, delivery } = buildTracking({
    orderStatus,
    createdAt: ORDER_CREATED,
    fastlinkStatus,
    dispatchedAt: sent.length ? at(0) : null,
    events,
  });

  const send = (status) => { setSent((s) => [...s, status]); setPreset("Custom"); };
  const applyPreset = (p) => { setSent(p.seq); setPreset(p.name); };
  const reset = () => { setSent([]); setPreset("Just placed"); };

  const nextInLifecycle = LIFECYCLE.find((s) => !sent.includes(s));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-primary" /> Delivery tracking simulator
          </h1>
          <p className="text-sm text-gray-600 mt-1.5 max-w-3xl">
            Drives the real <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">buildTracking()</code>,
            the real status mapping and the real tracking card, applying events the way the
            webhook receiver does. Nothing is mocked except the events themselves.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">

          {/* ── Controls ─────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">Scenarios</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Chip key={p.name} active={preset === p.name} onClick={() => applyPreset(p)}>
                    {p.name}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-1">Send an event</p>
              <p className="text-[11px] text-gray-500 mb-3">
                Each click is one webhook delivery. Sending the same status twice is a
                redelivery — the receiver writes nothing, and the timeline should not move.
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {nextInLifecycle ? (
                  <Chip active onClick={() => send(nextInLifecycle)}>
                    <span className="inline-flex items-center gap-1.5">
                      <Zap className="w-3 h-3" /> Next: {nextInLifecycle}
                    </span>
                  </Chip>
                ) : (
                  <span className="text-xs text-gray-400">Lifecycle complete</span>
                )}
                {fastlinkStatus && (
                  <Chip tone="gray" onClick={() => send(fastlinkStatus)}>
                    Redeliver “{fastlinkStatus}”
                  </Chip>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {DISRUPTIONS.map((d) => (
                  <Chip key={d.status} tone={d.tone} onClick={() => send(d.status)}>{d.label}</Chip>
                ))}
              </div>
              <button
                onClick={reset}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </button>
            </div>

            {/* Event log — shows what was actually recorded vs merely received */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
                Recorded events <span className="font-normal text-gray-400">({events.length} of {sent.length} received)</span>
              </p>
              {events.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing yet — the order has not been dispatched.</p>
              ) : (
                <ol className="space-y-1.5">
                  {events.map((e, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-gray-700">{e.fastlink_status}</span>
                      <span className="text-gray-400">
                        → {e.carmel_status ?? <span className="text-amber-600">unmapped</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {sent.length > events.length && (
                <p className="mt-3 text-[11px] text-gray-500 border-t border-gray-100 pt-2">
                  {sent.length - events.length} redelivered event
                  {sent.length - events.length === 1 ? "" : "s"} written nothing — idempotency working.
                </p>
              )}
            </div>

            {/* What the API hands the page */}
            <div className="bg-gray-900 rounded-2xl p-4 overflow-x-auto">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">API response · delivery</p>
              <pre className="text-[11px] leading-relaxed text-green-300 font-mono">
{JSON.stringify(delivery, null, 2)}
              </pre>
            </div>
          </div>

          {/* ── Live preview ─────────────────────────────────────────── */}
          <div className="lg:col-span-3 space-y-4">

            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Order status</span>
              <span className="font-mono font-semibold text-gray-900 bg-gray-100 rounded-full px-2.5 py-1">{orderStatus}</span>
              <span className="text-gray-500">· courier</span>
              <span className="font-mono font-semibold text-gray-900 bg-gray-100 rounded-full px-2.5 py-1">
                {fastlinkStatus ?? "—"}
              </span>
            </div>

            <DeliveryTrackingCard
              tracking={tracking}
              delivery={delivery}
              orderStatus={orderStatus}
              notes={orderStatus === "cancelled" ? "Cancelled by the courier." : null}
              animate={false}
            />

            {/* Orders-list row, so the badge can be judged in context */}
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">As it appears in the orders list</p>
              <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Package className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-bold text-gray-900 text-sm">#CM-8F3A21C0</p>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 bg-purple-100 text-purple-700">
                      {orderStatus}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-1 mb-1">Ankara Tote Bag + 2 more</p>
                  {isIssueStatus(fastlinkStatus) && (
                    <span className="inline-flex items-center gap-1 mb-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      Delivery issue
                    </span>
                  )}
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>8 Aug 2026</span><span>·</span>
                    <span className="font-semibold text-gray-900">₦24,500</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900 space-y-1.5">
              <p className="font-bold">Worth trying</p>
              <p>· <b>Postponed</b> then <b>out_for_delivery</b> — the step keeps its original time rather than creeping forward.</p>
              <p>· <b>Delivered</b> then any earlier status — the order does not regress.</p>
              <p>· <b>Unknown status</b> — recorded, but no banner and no status change. We never guess.</p>
              <p>· Redeliver the current status — nothing is written.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

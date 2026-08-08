"use client";


// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, MapPin, Phone, User, Check, Loader2,
  X, RefreshCw, Bike, AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import toast from "react-hot-toast";

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:    { label: "Pending",          cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"     },
  confirmed:  { label: "Confirmed",        cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"         },
  processing: { label: "Picked Up",        cls: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400" },
  shipped:    { label: "Out for Delivery", cls: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  delivered:  { label: "Delivered",        cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"     },
  cancelled:  { label: "Cancelled",        cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"             },
};

const STATUS_NEXT = {
  pending:    "confirmed",
  confirmed:  "processing",
  processing: "shipped",
  shipped:    "delivered",
};

// Rider-facing labels for the action button — keyed by CURRENT order status
const ACTION_LABEL = {
  pending:    "Accept Order",
  confirmed:  "Confirm Pickup",
  processing: "Out for Delivery",
  shipped:    "Mark Delivered",
};

const ACTION_COLOR = {
  shipped:    "bg-emerald-600 hover:bg-emerald-700 text-white",
  processing: "bg-purple-600 hover:bg-purple-700 text-white",
  confirmed:  "bg-indigo-600 hover:bg-indigo-700 text-white",
  pending:    "bg-gray-800 hover:bg-gray-700 dark:bg-gray-200 dark:hover:bg-gray-300 text-white dark:text-gray-900",
};

// Lower = more urgent (shown first)
const URGENCY = { shipped: 0, processing: 1, confirmed: 2, pending: 3 };

const ACTIVE_STATUSES = ["pending", "confirmed", "processing", "shipped"];

const TABS = [
  { value: "active",    label: "Active"    },
  { value: "",          label: "All"       },
  { value: "delivered", label: "Delivered" },
];

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }) {
  const c = STATUS_CFG[status] ?? { label: status, cls: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${c.cls}`}>
      {c.label}
    </span>
  );
}

// ── Bottom sheet ──────────────────────────────────────────────────────────────

function OrderSheet({ order, onClose, onStatusUpdate, updating }) {
  const addr       = order.delivery_address ?? {};
  const nextStatus = STATUS_NEXT[order.status];
  const isTerminal = ["delivered", "cancelled", "refunded"].includes(order.status);
  const isBusy     = updating === order.id;

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      <motion.div
        className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl flex flex-col"
        style={{ maxHeight: "90dvh" }}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 320 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.25 }}
        onDragEnd={(_, info) => { if (info.offset.y > 100) onClose(); }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Sheet header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <p className="font-extrabold text-gray-900 dark:text-gray-100">{order.shortId}</p>
            <StatusPill status={order.status} />
          </div>
          <button
            onClick={onClose}
            className="p-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Customer + Call button */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">Customer</p>
              <p className="font-bold text-gray-900 dark:text-gray-100 text-base">{order.customer.name}</p>
              <p className="text-xs text-green-600 dark:text-green-400 font-semibold mt-0.5">✓ Paid online · ₦{(order.total ?? 0).toLocaleString("en-NG")}</p>
            </div>
            {order.customer.phone && (
              <a
                href={`tel:${order.customer.phone}`}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold px-5 py-3 rounded-2xl text-sm transition-colors shrink-0"
              >
                <Phone className="w-4 h-4" />
                Call
              </a>
            )}
          </div>

          {/* Delivery address */}
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-4 space-y-1.5">
            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Delivery Address
            </p>
            {[addr.houseNumber, addr.street].filter(Boolean).length > 0 && (
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {[addr.houseNumber, addr.street].filter(Boolean).join(" ")}
              </p>
            )}
            {addr.area && <p className="text-sm text-gray-600 dark:text-gray-400">{addr.area}</p>}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {[addr.city, addr.lga, addr.state].filter(Boolean).join(", ")}
            </p>
            {addr.landmark && (
              <p className="text-sm font-bold text-amber-700 dark:text-amber-400 pt-1">
                📍 {addr.landmark}
              </p>
            )}
            {addr.delivery_instructions && (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
                "{addr.delivery_instructions}"
              </p>
            )}
          </div>
        </div>

        {/* Sticky action footer */}
        <div
          className="px-5 pt-3 border-t border-gray-100 dark:border-gray-800 shrink-0"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          {!isTerminal && nextStatus && (
            <button
              onClick={() => onStatusUpdate(order.id, nextStatus)}
              disabled={isBusy}
              className={`w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl font-extrabold text-base transition-colors disabled:opacity-60 active:scale-[0.98] ${ACTION_COLOR[order.status] ?? "bg-gray-900 text-white"}`}
            >
              {isBusy ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  {ACTION_LABEL[order.status] ?? `Mark as ${nextStatus}`}
                </>
              )}
            </button>
          )}
          {order.status === "delivered" && (
            <div className="flex items-center justify-center gap-2 py-4 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl">
              <Check className="w-5 h-5" />
              <p className="font-bold text-base">Delivery Complete</p>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({ order, onOpen, onStatusUpdate, updating }) {
  const addr       = order.delivery_address ?? {};
  const nextStatus = STATUS_NEXT[order.status];
  const isTerminal = ["delivered", "cancelled", "refunded"].includes(order.status);
  const isBusy    = updating === order.id;
  const isShipped = order.status === "shipped";

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-3xl overflow-hidden transition-shadow ${
        isShipped
          ? "ring-2 ring-emerald-500 dark:ring-emerald-600 shadow-lg shadow-emerald-100 dark:shadow-emerald-900/20"
          : "border border-gray-100 dark:border-gray-700"
      }`}
    >
      {/* Tappable content area → opens sheet */}
      <button className="w-full text-left px-4 pt-4 pb-3.5 space-y-3" onClick={() => onOpen(order)}>
        {/* Top row */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-extrabold text-emerald-700 dark:text-emerald-400 text-sm tracking-wide">{order.shortId}</span>
          <StatusPill status={order.status} />
        </div>

        {/* Customer + inline call */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <User className="w-4 h-4 text-gray-400 shrink-0" />
            <p className="font-bold text-gray-900 dark:text-gray-100 truncate">{order.customer.name}</p>
          </div>
          {order.customer.phone && (
            <a
              href={`tel:${order.customer.phone}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700 px-3 py-2 rounded-xl text-xs font-bold shrink-0 active:bg-emerald-100"
            >
              <Phone className="w-3.5 h-3.5" />
              Call
            </a>
          )}
        </div>

        {/* Address */}
        <div className="flex items-start gap-2">
          <MapPin className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
              {[addr.area || addr.street, addr.city].filter(Boolean).join(", ") || "—"}
            </p>
            {addr.landmark && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold truncate mt-0.5">
                📍 {addr.landmark}
              </p>
            )}
          </div>
        </div>

        {/* Amount */}
        <div className="flex items-center justify-between">
          <p className="font-extrabold text-gray-900 dark:text-gray-100">
            ₦{(order.total ?? 0).toLocaleString("en-NG")}
          </p>
        </div>
      </button>

      {/* Primary action — flush to card bottom, large tap target */}
      {!isTerminal && nextStatus ? (
        <button
          onClick={() => onStatusUpdate(order.id, nextStatus)}
          disabled={isBusy}
          className={`w-full flex items-center justify-center gap-2 py-4 font-extrabold text-sm transition-colors disabled:opacity-60 active:brightness-90 ${ACTION_COLOR[order.status] ?? "bg-gray-900 text-white"}`}
        >
          {isBusy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Check className="w-4 h-4" />
              {ACTION_LABEL[order.status] ?? nextStatus}
            </>
          )}
        </button>
      ) : order.status === "delivered" ? (
        <div className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10 border-t border-green-100 dark:border-green-900/30">
          <Check className="w-3.5 h-3.5" />
          Delivered
        </div>
      ) : null}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RiderOrdersPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Default to Active tab — that's what riders care about most
  const [tab,       setTab]       = useState("active");
  const [openOrder, setOpenOrder] = useState(null);
  const [updating,  setUpdating]  = useState(null);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["rider-orders"],
    queryFn:  async () => {
      const r = await fetch("/api/rider/orders");
      if (!r.ok) throw new Error("Failed to fetch orders");
      return r.json();
    },
    staleTime: 30_000,
    retry:     false,
  });

  // Realtime: re-fetch only when THIS rider's orders change
  useEffect(() => {
    if (!user?.id) return;
    const supabase = createClient();
    const channel  = supabase
      .channel("rider-orders-feed")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `rider_id=eq.${user.id}` },
        () => { qc.invalidateQueries({ queryKey: ["rider-orders"] }); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc, user?.id]);

  const handleStatusUpdate = async (orderId, newStatus) => {
    setUpdating(orderId);
    try {
      const r = await fetch(`/api/rider/orders/${orderId}/status`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status: newStatus }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to update status");

      const toasts = {
        delivered:  "Delivery confirmed! Great work.",
        shipped:    "Marked out for delivery.",
        processing: "Pickup confirmed.",
        confirmed:  "Order confirmed.",
      };
      toast.success(toasts[newStatus] ?? `Marked as ${newStatus}`);
      qc.invalidateQueries({ queryKey: ["rider-orders"] });

      if (openOrder?.id === orderId) {
        if (newStatus === "delivered") {
          // Small delay so rider sees the "Delivered" state before sheet closes
          setTimeout(() => setOpenOrder(null), 900);
        } else {
          setOpenOrder((prev) => prev ? { ...prev, status: newStatus } : null);
        }
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUpdating(null);
    }
  };

  let orders = data?.orders ?? [];

  if (tab === "active") {
    orders = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  } else if (tab === "delivered") {
    orders = orders.filter((o) => o.status === "delivered");
  }

  // Sort by urgency so "Out for Delivery" always rises to the top
  orders = [...orders].sort((a, b) => {
    const ua = URGENCY[a.status] ?? 50;
    const ub = URGENCY[b.status] ?? 50;
    if (ua !== ub) return ua - ub;
    // Secondary: most recently updated first
    return new Date(b.updated_at ?? b.created_at) - new Date(a.updated_at ?? a.created_at);
  });

  const allOrders      = data?.orders ?? [];
  const activeCount    = allOrders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length;
  const deliveredCount = allOrders.filter((o) => o.status === "delivered").length;

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl px-3.5 py-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{activeCount} Active</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-3.5 py-2.5">
          <Check className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />
          <p className="text-sm font-bold text-gray-500 dark:text-gray-400">{deliveredCount} Done</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          title="Refresh"
          className="ml-auto p-2.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-2xl">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold rounded-xl transition-colors ${
              tab === value
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {label}
            {value === "active" && activeCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold">
                {activeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="w-8 h-8 text-gray-300 dark:text-gray-600 animate-spin" />
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading deliveries…</p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 bg-white dark:bg-gray-800 rounded-3xl border border-red-100 dark:border-red-900/30">
          <AlertCircle className="w-10 h-10 text-red-400 dark:text-red-500" />
          <p className="font-bold text-gray-700 dark:text-gray-300">Failed to load deliveries</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">Check your connection and try again.</p>
          <button
            onClick={() => refetch()}
            className="mt-1 flex items-center gap-2 px-4 py-2 text-sm font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-24 bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700">
          <Bike className="w-14 h-14 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
          <p className="font-bold text-gray-500 dark:text-gray-400">
            {tab === "active"
              ? "No active deliveries"
              : tab === "delivered"
              ? "No completed deliveries yet"
              : "No deliveries yet"}
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            {tab === "delivered"
              ? "Completed deliveries will appear here."
              : "Orders assigned to you will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <TaskCard
              key={order.id}
              order={order}
              onOpen={setOpenOrder}
              onStatusUpdate={handleStatusUpdate}
              updating={updating}
            />
          ))}
        </div>
      )}

      {/* Bottom sheet */}
      <AnimatePresence>
        {openOrder && (
          <OrderSheet
            key={openOrder.id}
            order={openOrder}
            onClose={() => setOpenOrder(null)}
            onStatusUpdate={handleStatusUpdate}
            updating={updating}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

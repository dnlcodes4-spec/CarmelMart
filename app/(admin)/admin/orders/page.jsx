"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Download, RefreshCw, RotateCcw, X, Bike, ChevronDown, Package, MapPin, User, CreditCard, Eye, AlertTriangle } from "lucide-react";
import { needsReview, describeIssue } from "@/lib/fastlink/status";
import Image from "next/image";
import toast from "react-hot-toast";

async function fetchOrderDetail(id) {
  const r = await fetch(`/api/admin/orders/${id}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Failed to load order");
  return d;
}

async function fetchOrders(params) {
  const r = await fetch(`/api/admin/orders?${params}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Failed to load orders");
  return d;
}

async function fetchActiveRiders() {
  const r = await fetch("/api/admin/riders?active=true");
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Failed to load riders");
  return d;
}

const STATUS_CFG = {
  pending:   { label: "Pending",   cls: "bg-amber-50  text-amber-700  border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800"   },
  confirmed: { label: "Confirmed", cls: "bg-blue-50   text-blue-700   border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800"    },
  processing:{ label: "Processing",cls: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800"},
  shipped:   { label: "Shipped",   cls: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800"  },
  delivered: { label: "Delivered", cls: "bg-green-50  text-green-700  border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"   },
  cancelled: { label: "Cancelled", cls: "bg-red-50    text-red-700    border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"     },
  refunded:  { label: "Refunded",  cls: "bg-gray-100  text-gray-600   border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600"    },
};

/**
 * Shown when the delivery failed but the order did not. The webhook deliberately
 * leaves orders.status alone for these, so without a marker here an order whose
 * delivery was cancelled looks completely healthy in this list.
 */
function DeliveryFlag({ fastlinkStatus }) {
  if (!needsReview(fastlinkStatus)) return null;
  return (
    <span
      title={describeIssue(fastlinkStatus)?.title ?? "Delivery needs attention"}
      className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800"
    >
      <AlertTriangle className="h-3 w-3" /> Delivery
    </span>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_CFG[status] ?? { label: status, cls: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${c.cls}`}>
      {c.label}
    </span>
  );
}

const PAYMENT_METHOD_LABEL = { card: "Card (Flutterwave)", pod: "Pay on Delivery", wallet: "Wallet", transfer: "Bank Transfer" };
const PAYMENT_STATUS_CLS   = { paid: "text-green-700 bg-green-50 border-green-200", pending: "text-amber-700 bg-amber-50 border-amber-200", failed: "text-red-700 bg-red-50 border-red-200" };

function OrderDetailModal({ orderId, onClose, onAssignRider, onRefund }) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-order-detail", orderId],
    queryFn: () => fetchOrderDetail(orderId),
    enabled: !!orderId,
    staleTime: 30_000,
  });
  const order = data?.order ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 z-10">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-100">{order?.shortId ?? "Order Detail"}</h3>
            {order && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{order.date}</p>}
          </div>
          <div className="flex items-center gap-2">
            {order && <StatusBadge status={order.status} />}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-6 h-6 text-gray-300 animate-spin" />
          </div>
        ) : !order ? (
          <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">Failed to load order detail.</div>
        ) : (
          <div className="p-6 space-y-6">

            {/* Order items */}
            <div>
              <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> Items Ordered
              </h4>
              <div className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Product</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 hidden sm:table-cell">Vendor</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Qty</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Unit</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {order.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 shrink-0 overflow-hidden flex items-center justify-center">
                              {item.image
                                ? <Image src={item.image} alt={item.product_name} width={36} height={36} className="object-cover w-full h-full" />
                                : <Package className="w-4 h-4 text-gray-300 dark:text-gray-500" />
                              }
                            </div>
                            <div>
                              <span className="font-medium text-gray-900 dark:text-gray-100 line-clamp-1">{item.product_name}</span>
                              {item.variant_combination && (
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                  {Object.entries(item.variant_combination).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 hidden sm:table-cell">{item.vendor_name ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{item.quantity}</td>
                        <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">₦{item.unit_price.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-gray-100">₦{item.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment breakdown */}
            <div>
              <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" /> Payment Breakdown
              </h4>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {[
                  { label: "Items Subtotal",                   value: `₦${order.items_subtotal.toLocaleString()}` },
                  { label: "Delivery Fee",                     value: `₦${order.delivery_fee.toLocaleString()}` },
                  { label: `Platform Commission (${order.platform_rate}%)`, value: `₦${order.platform_fee.toLocaleString()}`, note: true },
                ].map(({ label, value, note }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2.5">
                    <span className={`text-sm ${note ? "text-primary dark:text-primary-light" : "text-gray-600 dark:text-gray-400"}`}>{label}</span>
                    <span className={`text-sm font-semibold ${note ? "text-primary dark:text-primary-light" : "text-gray-800 dark:text-gray-200"}`}>{value}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="font-bold text-gray-900 dark:text-gray-100">Total Paid</span>
                  <span className="font-extrabold text-gray-900 dark:text-gray-100 text-lg">₦{order.total.toLocaleString()}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full border ${PAYMENT_STATUS_CLS[order.payment_status] ?? "text-gray-600 bg-gray-50 border-gray-200"}`}>
                  {order.payment_status === "paid" ? "Paid" : order.payment_status === "pending" ? "Pending" : (order.payment_status ?? "Unknown")}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  via {PAYMENT_METHOD_LABEL[order.payment_method] ?? order.payment_method ?? "Unknown"}
                </span>
                {order.payment_ref && (
                  <span className="text-xs font-mono text-gray-400 dark:text-gray-500">Ref: {order.payment_ref}</span>
                )}
                {order.pod_deposit > 0 && (
                  <span className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full font-semibold">
                    POD deposit: ₦{order.pod_deposit.toLocaleString()}
                  </span>
                )}
              </div>
            </div>

            {/* Customer + Address */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Customer
                </h4>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4 space-y-1 text-sm">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{order.customer.name}</p>
                  {order.customer.email && <p className="text-gray-500 dark:text-gray-400">{order.customer.email}</p>}
                  {order.customer.phone && <p className="text-gray-500 dark:text-gray-400">{order.customer.phone}</p>}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Delivery Address
                </h4>
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4 text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                  {order.address.fullName && <p className="font-semibold text-gray-900 dark:text-gray-100">{order.address.fullName}</p>}
                  {order.address.street   && <p>{[order.address.houseNumber, order.address.street].filter(Boolean).join(" ")}</p>}
                  {order.address.landmark && <p className="text-gray-500 dark:text-gray-400">Near: {order.address.landmark}</p>}
                  {(order.address.city || order.address.state) && (
                    <p>{[order.address.area, order.address.city, order.address.state].filter(Boolean).join(", ")}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              {!["delivered", "cancelled", "refunded"].includes(order.status) && (
                <button
                  onClick={() => { onAssignRider({ id: order.id, shortId: order.shortId, city: order.address?.city, rider_id: null, rider_name: null }); onClose(); }}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                >
                  <Bike className="w-3.5 h-3.5" /> Assign Rider
                </button>
              )}
              {!["refunded", "cancelled"].includes(order.status) && (
                <button
                  onClick={() => { onRefund({ id: order.id, shortId: order.shortId, customer: order.customer.name, customerId: order.customer.id, total: order.total }); onClose(); }}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Issue Refund
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RefundModal({ order, onClose, onConfirm, saving }) {
  const [amount, setAmount] = useState(order?.total ?? "");
  const [reason, setReason] = useState("");
  if (!order) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">Issue Refund</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Refund credited to <strong>{order.customer}</strong>'s wallet. Max ₦{order.total.toLocaleString()}.
        </p>
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Amount (₦)</label>
          <input type="number" min="1" max={order.total > 0 ? order.total : undefined} value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Item not delivered"
            className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500" />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">Cancel</button>
          <button
            onClick={() => onConfirm(Number(amount), reason)}
            disabled={saving || !amount || Number(amount) <= 0}
            className="px-4 py-2 text-sm font-semibold text-white bg-primary hover:bg-primary-dark disabled:opacity-60 rounded-xl transition-colors flex items-center gap-2"
          >
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Issue Refund
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignRiderModal({ order, riders, onClose, onConfirm, saving }) {
  const [riderId, setRiderId] = useState(order?.rider_id ?? "");
  if (!order) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">Assign Rider</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Order <strong>{order.shortId}</strong> · {order.city}
        </p>
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Select Rider</label>
          <div className="relative">
            <select
              value={riderId}
              onChange={(e) => setRiderId(e.target.value)}
              className="w-full appearance-none px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 pr-10"
            >
              <option value="">— Unassign —</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.phone ? ` · ${r.phone}` : ""}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          {riders.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">No active riders found. Add riders from the Riders page.</p>
          )}
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">Cancel</button>
          <button
            onClick={() => onConfirm(riderId || null)}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl transition-colors flex items-center gap-2"
          >
            {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_TABS = [
  { value: "",          label: "All"       },
  { value: "pending",   label: "Pending"   },
  { value: "confirmed", label: "Confirmed" },
  { value: "shipped",   label: "Shipped"   },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export default function AdminOrdersPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [page,         setPage]         = useState(1);
  const [refundOrder,  setRefundOrder]  = useState(null);
  const [assignOrder,  setAssignOrder]  = useState(null);
  const [detailId,     setDetailId]     = useState(null);

  const params = new URLSearchParams({ page });
  if (statusFilter) params.set("status", statusFilter);

  const { data, isLoading, isError, error: ordersError } = useQuery({
    queryKey: ["admin-orders", statusFilter, page],
    queryFn: () => fetchOrders(params.toString()),
    staleTime: 30_000,
    retry: false,
  });

  const { data: ridersData } = useQuery({
    queryKey: ["admin-active-riders"],
    queryFn: fetchActiveRiders,
    staleTime: 60_000,
    enabled: !!assignOrder,
  });
  const activeRiders = ridersData?.riders ?? [];

  const refundMutation = useMutation({
    mutationFn: async ({ order_id, customer_id, amount, reason }) => {
      const r = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id, customer_id, amount, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Refund failed");
      return d;
    },
    onSuccess: () => {
      toast.success("Refund issued — wallet credited");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      setRefundOrder(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ order_id, rider_id }) => {
      const r = await fetch(`/api/admin/orders/${order_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rider_id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Assignment failed");
      return d;
    },
    onSuccess: (_, { rider_id }) => {
      toast.success(rider_id ? "Rider assigned" : "Rider unassigned");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      setAssignOrder(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const orders = data?.orders ?? [];
  const pages  = data?.pages  ?? 1;
  const total  = data?.total  ?? 0;

  return (
    <div className="space-y-5">
      {detailId && (
        <OrderDetailModal
          orderId={detailId}
          onClose={() => setDetailId(null)}
          onAssignRider={(o) => setAssignOrder(o)}
          onRefund={(o) => setRefundOrder(o)}
        />
      )}
      <RefundModal
        order={refundOrder}
        saving={refundMutation.isPending}
        onClose={() => setRefundOrder(null)}
        onConfirm={(amount, reason) => refundMutation.mutate({ order_id: refundOrder.id, customer_id: refundOrder.customerId, amount, reason })}
      />
      <AssignRiderModal
        order={assignOrder}
        riders={activeRiders}
        saving={assignMutation.isPending}
        onClose={() => setAssignOrder(null)}
        onConfirm={(rider_id) => assignMutation.mutate({ order_id: assignOrder.id, rider_id })}
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 text-xl">Orders</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{total.toLocaleString()} total platform orders</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {STATUS_TABS.map(({ value, label }) => (
          <button
            key={label}
            onClick={() => { setStatusFilter(value); setPage(1); }}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-colors shrink-0 ${
              statusFilter === value ? "bg-primary text-white shadow-sm" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-6 h-6 text-gray-300 dark:text-gray-600 animate-spin mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading orders…</p>
          </div>
        ) : isError ? (
          <div className="p-14 text-center">
            <p className="font-semibold text-red-500 dark:text-red-400 mb-1">Failed to load orders</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">{ordersError?.message}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-14 text-center">
            <ShoppingCart className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
            <p className="font-semibold text-gray-500 dark:text-gray-400">No orders found</p>
          </div>
        ) : (
          <>
            {/* ── Mobile card list (< lg) ───────────────────────────────────── */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {orders.map((o) => (
                <div key={o.id} className="p-4 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <button className="w-full text-left" onClick={() => setDetailId(o.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{o.shortId}</p>
                      <StatusBadge status={o.status} /><DeliveryFlag fastlinkStatus={o.fastlink_status} />
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mb-0.5">{o.customer}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                      {o.rider_name ? (
                        <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                          <Bike className="w-3 h-3" /> {o.rider_name}
                        </span>
                      ) : (
                        <span>No rider</span>
                      )}
                      {o.city && <span>{o.city}</span>}
                      {o.date && <span>{o.date}</span>}
                    </div>
                  </div>
                  </button>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50 dark:border-gray-700/60">
                    <p className="font-bold text-gray-900 dark:text-gray-100">₦{(o.total || 0).toLocaleString()}</p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDetailId(o.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                      {!["delivered", "cancelled", "refunded"].includes(o.status) && (
                        <button
                          onClick={() => setAssignOrder(o)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                        >
                          <Bike className="w-3.5 h-3.5" /> Rider
                        </button>
                      )}
                      {!["refunded", "cancelled"].includes(o.status) && (
                        <button
                          onClick={() => setRefundOrder(o)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Refund
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop table (lg+) ──────────────────────────────────────── */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Order ID</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Customer</th>
                  <th className="px-5 py-3.5 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Amount</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden md:table-cell">Rider</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden lg:table-cell">City</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide hidden lg:table-cell">Date</th>
                  <th className="px-5 py-3.5 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer" onClick={() => setDetailId(o.id)}>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-primary">{o.shortId}</p>
                      <p className="text-xs font-mono text-gray-400 dark:text-gray-500">{o.id.slice(0, 8)}…</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-gray-700 dark:text-gray-300">{o.customer}</p>
                      {o.phone && <p className="text-xs text-gray-400 dark:text-gray-500">{o.phone}</p>}
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-gray-900 dark:text-gray-100">₦{(o.total || 0).toLocaleString()}</td>
                    <td className="px-5 py-4"><StatusBadge status={o.status} /><DeliveryFlag fastlinkStatus={o.fastlink_status} /></td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      {o.rider_name ? (
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          <Bike className="w-3.5 h-3.5" /> {o.rider_name}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-500 dark:text-gray-400 hidden lg:table-cell">{o.city}</td>
                    <td className="px-5 py-4 text-xs text-gray-500 dark:text-gray-400 hidden lg:table-cell">{o.date}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDetailId(o.id); }}
                          title="View order detail"
                          className="p-2 rounded-lg text-gray-400 dark:text-gray-500 hover:text-primary hover:bg-primary/5 transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {!["delivered", "cancelled", "refunded"].includes(o.status) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setAssignOrder(o); }}
                            title={o.rider_name ? `Reassign rider (${o.rider_name})` : "Assign rider"}
                            className={`p-2 rounded-lg transition-colors ${
                              o.rider_name
                                ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                : "text-gray-400 dark:text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                            }`}
                          >
                            <Bike className="w-4 h-4" />
                          </button>
                        )}
                        {!["refunded", "cancelled"].includes(o.status) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRefundOrder(o); }}
                            title="Issue refund to customer wallet"
                            className="p-2 rounded-lg text-gray-400 dark:text-gray-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {pages} · {total.toLocaleString()} orders</p>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-semibold border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Prev</button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                className="px-3 py-1.5 text-xs font-semibold border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

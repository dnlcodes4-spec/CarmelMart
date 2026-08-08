"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Store, Search, Check, XCircle, Ban, UserCheck, Eye,
  RefreshCw, Mail, Phone, CheckCircle, Clock, Gem, Crown, Package,
} from "lucide-react";
import Link from "next/link";
import toast from "react-hot-toast";
import { describeDuplicates } from "@/lib/vendors/duplicates";

async function fetchVendors(params) {
  const r = await fetch(`/api/admin/vendors?${params}`);
  return r.json();
}

const VENDOR_STATUS_CFG = {
  pending:   { label: "Pending",   cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800"  },
  verified:  { label: "Verified",  cls: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"  },
  rejected:  { label: "Rejected",  cls: "bg-red-50   text-red-700   border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"    },
  suspended: { label: "Suspended", cls: "bg-gray-100 text-gray-600  border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600"   },
};

function StatusBadge({ status }) {
  const c = VENDOR_STATUS_CFG[status] ?? VENDOR_STATUS_CFG.pending;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${c.cls}`}>
      {c.label}
    </span>
  );
}

const TIER_CFG = {
  vip:     { label: "VIP",     Icon: Crown, cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800" },
  premium: { label: "Premium", Icon: Gem,   cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800"       },
};

function TierBadge({ tier }) {
  const cfg = TIER_CFG[tier];
  if (!cfg) return null;
  const { Icon, label, cls } = cfg;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>
      <Icon className="w-2.5 h-2.5" />{label}
    </span>
  );
}

function ConfirmDialog({ open, title, message, confirmLabel, confirmCls, onConfirm, onCancel, withReason }) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-2">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{message}</p>
        {withReason && (
          <textarea
            className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm resize-none h-24 mb-4 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <div className="flex items-center justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">Cancel</button>
          <button onClick={() => onConfirm(reason)} className={`px-4 py-2 text-sm font-semibold text-white rounded-xl transition-colors ${confirmCls}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminVendorsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter]     = useState("all");
  const [search, setSearch]             = useState("");
  const [page, setPage]                 = useState(1);
  const [confirm, setConfirm]           = useState(null);

  const params = new URLSearchParams({ status: statusFilter, page });
  if (search) params.set("search", search);
  if (tierFilter !== "all") params.set("tier", tierFilter);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-vendors", statusFilter, tierFilter, search, page],
    queryFn: () => fetchVendors(params.toString()),
    staleTime: 30_000,
    retry: false,
  });

  const { mutate: doAction, isPending } = useMutation({
    mutationFn: async ({ vendorId, action, reason }) => {
      const r = await fetch(`/api/admin/vendors/${vendorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      return d;
    },
    onSuccess: (data, { action }) => {
      toast.success(`Vendor ${action}d`);

      // Sellers who mistype their email at signup register again rather than
      // recover the account, so the same business ends up verified twice — and
      // each copy becomes its own delivery-provider merchant. Approval is the
      // moment an admin is looking at the vendor and can act on it.
      const warning = action === "approve" ? describeDuplicates(data?.duplicates) : null;
      if (warning) {
        toast(warning, { icon: "⚠️", duration: 15_000, style: { maxWidth: "32rem" } });
      }

      qc.invalidateQueries({ queryKey: ["admin-vendors"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      setConfirm(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleAction = (vendorId, action) => {
    if (action === "reject" || action === "suspend") {
      setConfirm({ vendorId, action });
    } else {
      doAction({ vendorId, action });
    }
  };

  const vendors = data?.vendors ?? [];
  const pages   = data?.pages   ?? 1;
  const total   = data?.total   ?? 0;

  const STATUS_TABS = ["all", "pending", "verified", "suspended", "rejected"];
  const TIER_TABS   = [
    { id: "all",     label: "All Tiers" },
    { id: "free",    label: "Basic" },
    { id: "premium", label: "Premium" },
    { id: "vip",     label: "VIP" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 text-xl">Vendor Management</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{total.toLocaleString()} vendors registered</p>
        </div>
        <div className="sm:ml-auto relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="Search by business name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl capitalize whitespace-nowrap transition-colors shrink-0 ${
                statusFilter === s ? "bg-primary text-white shadow-sm" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {TIER_TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { setTierFilter(id); setPage(1); }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-colors shrink-0 ${
                tierFilter === id ? "bg-primary text-white shadow-sm" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-6 h-6 text-gray-300 dark:text-gray-600 animate-spin mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading vendors…</p>
          </div>
        ) : vendors.length === 0 ? (
          <div className="p-14 text-center">
            <Store className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
            <p className="font-semibold text-gray-500 dark:text-gray-400">No vendors found</p>
          </div>
        ) : (
          <>
            {/* ── Mobile card list (< lg) ───────────────────────────────────── */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {vendors.map((v) => (
                <div key={v.id} className="p-4">
                  {/* Top: store icon + name + tier badge + status badge */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
                      <Store className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{v.business_name}</p>
                          <TierBadge tier={v.subscription_tier} />
                        </div>
                        <StatusBadge status={v.verification_status} />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{v.email ?? "—"}</p>
                    </div>
                  </div>
                  {/* Middle: KYC chips + phone + date */}
                  <div className="flex items-center justify-between mt-2.5 gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${v.nin_verified ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" : "bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600"}`}>NIN</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${v.cac_verified ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800" : "bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600"}`}>CAC</span>
                      {v.phone && <p className="text-xs text-gray-500 dark:text-gray-400">{v.phone}</p>}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                      {new Date(v.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  {/* Bottom: action buttons */}
                  <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-gray-50 dark:border-gray-700/60">
                    <Link
                      href={`/admin/vendors/${v.id}`}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </Link>
                    {v.verification_status === "pending" && (
                      <>
                        <button
                          onClick={() => doAction({ vendorId: v.id, action: "approve" })}
                          disabled={isPending}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => handleAction(v.id, "reject")}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                      </>
                    )}
                    {v.verification_status === "verified" && (
                      <button
                        onClick={() => handleAction(v.id, "suspend")}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                      >
                        <Ban className="w-3.5 h-3.5" /> Suspend
                      </button>
                    )}
                    {v.verification_status === "suspended" && (
                      <button
                        onClick={() => doAction({ vendorId: v.id, action: "unsuspend" })}
                        disabled={isPending}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Reinstate
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop table (lg+) ──────────────────────────────────────── */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Business</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Contact</th>
                  <th className="px-5 py-3.5 text-center text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">KYC</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Joined</th>
                  <th className="px-5 py-3.5 text-right text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {vendors.map((v) => (
                  <tr key={v.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
                          <Store className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-gray-900 dark:text-gray-100">{v.business_name}</p>
                            <TierBadge tier={v.subscription_tier} />
                          </div>
                          <p className="text-xs font-mono text-gray-400 dark:text-gray-500">{v.id.slice(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-gray-700 dark:text-gray-300">{v.email ?? "—"}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{v.phone ?? "—"}</p>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-3">
                        <span className={`text-xs font-bold ${v.nin_verified ? "text-green-600" : "text-gray-300 dark:text-gray-600"}`}>NIN</span>
                        <span className={`text-xs font-bold ${v.cac_verified ? "text-green-600" : "text-gray-300 dark:text-gray-600"}`}>CAC</span>
                      </div>
                    </td>
                    <td className="px-5 py-4"><StatusBadge status={v.verification_status} /></td>
                    <td className="px-5 py-4 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(v.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/admin/vendors/${v.id}`}
                          className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        {v.verification_status === "pending" && (
                          <>
                            <button onClick={() => doAction({ vendorId: v.id, action: "approve" })} disabled={isPending}
                              className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors" title="Approve">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleAction(v.id, "reject")}
                              className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Reject">
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {v.verification_status === "verified" && (
                          <button onClick={() => handleAction(v.id, "suspend")}
                            className="p-2 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors" title="Suspend">
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                        {v.verification_status === "suspended" && (
                          <button onClick={() => doAction({ vendorId: v.id, action: "unsuspend" })} disabled={isPending}
                            className="p-2 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors" title="Reinstate">
                            <UserCheck className="w-4 h-4" />
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
            <p className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {pages}</p>
            <div className="flex gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs font-semibold border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Prev</button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}
                className="px-3 py-1.5 text-xs font-semibold border border-gray-200 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === "reject" ? "Reject Vendor?" : "Suspend Vendor?"}
        message={confirm?.action === "reject"
          ? "Their application will be rejected. They can re-apply after addressing the issues."
          : "Their products will be hidden from the store. Reversible at any time."}
        confirmLabel={confirm?.action === "reject" ? "Reject" : "Suspend"}
        confirmCls={confirm?.action === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}
        withReason
        onConfirm={(reason) => doAction({ vendorId: confirm.vendorId, action: confirm.action, reason })}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

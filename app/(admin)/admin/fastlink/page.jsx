"use client";

/**
 * Admin · Pickup points.
 *
 * Fast Link cannot price or dispatch a vendor's orders without a pickup point,
 * and a typed address cannot supply one — audited across all 61 verified vendors,
 * exactly one could be geocoded to the correct state. Vendors are prompted in
 * their own portal; this screen exists for the tail who never log in, so ops can
 * place the point while on the phone with them.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Package, Phone, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import MapPickupPicker from "@/components/shared/MapPickupPicker";

const fetchPending = async () => {
  const r = await fetch("/api/admin/fastlink/pickup");
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Failed to load");
  return d;
};

export default function AdminPickupPointsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [point, setPoint] = useState(null);
  const [note, setNote] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-fastlink-pickup"],
    queryFn: fetchPending,
  });

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/admin/fastlink/pickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: selected.id,
          latitude: point.latitude,
          longitude: point.longitude,
          address: note.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to save");
      return d;
    },
    onSuccess: (d) => {
      toast.success(
        d.synced
          ? `Pickup point set for ${selected.business_name}.`
          : `Saved, but the delivery provider did not accept it yet — retry later.`,
      );
      setSelected(null); setPoint(null); setNote("");
      qc.invalidateQueries({ queryKey: ["admin-fastlink-pickup"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const vendors = data?.vendors ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
        <MapPin className="h-6 w-6 text-primary" /> Pickup points
      </h1>
      <p className="mt-1.5 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
        Vendors without a pickup point cannot be dispatched through the delivery provider —
        their orders fall back to zone pricing and an in-house rider. Those with active
        products are listed first; they are the only ones this currently blocks.
      </p>

      {data && (
        <div className="mt-5 flex flex-wrap gap-3">
          {[
            ["Still missing a point", data.total, "text-gray-900 dark:text-gray-100"],
            ["Of those, actively selling", data.withActiveProducts, "text-amber-600"],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-2xl border border-gray-100 bg-white px-5 py-3 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
              <p className={`text-2xl font-bold ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading && <p className="mt-6 text-sm text-gray-500">Loading…</p>}
      {isError && (
        <p className="mt-6 flex items-center gap-2 text-sm text-red-600">
          <AlertTriangle className="h-4 w-4" /> {error.message}
        </p>
      )}

      {data && vendors.length === 0 && (
        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Every verified vendor has a pickup point.
        </div>
      )}

      <div className="mt-6 space-y-2">
        {vendors.map((v) => (
          <div key={v.id} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold text-gray-900 dark:text-gray-100">
                  {v.business_name || "(no name)"}
                  {v.hasActiveProducts && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                      <Package className="h-3 w-3" /> selling
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-500">{v.address || "no address on file"}</p>
                {v.phone && (
                  <a href={`tel:${v.phone}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    <Phone className="h-3 w-3" /> {v.phone}
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelected(selected?.id === v.id ? null : v);
                  setPoint(null); setNote("");
                }}
                className="shrink-0 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white hover:opacity-90"
              >
                {selected?.id === v.id ? "Cancel" : "Set point"}
              </button>
            </div>

            {selected?.id === v.id && (
              <div className="mt-4 space-y-3 border-t border-gray-100 pt-4 dark:border-gray-700">
                <p className="text-xs text-gray-500">
                  Ask the vendor for a landmark, find it on the map, and place the crosshair on
                  their door. Coordinates are what the rider is sent to.
                </p>
                <MapPickupPicker value={point} onChange={setPoint} disabled={save.isPending} />
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note for the rider — e.g. beside the blue gate"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => save.mutate()}
                  disabled={!point || save.isPending}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save pickup point
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

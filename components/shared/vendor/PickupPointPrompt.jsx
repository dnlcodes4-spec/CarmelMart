"use client";

/**
 * Asks a vendor to place their pickup point on a map.
 *
 * Without one, Fast Link cannot price or dispatch that vendor's orders — they
 * stay on the in-house rider path. Typed addresses cannot fill the gap: audited
 * against all 61 verified vendors, exactly one could be geocoded to the correct
 * state, so the coordinate has to come from the vendor.
 *
 * Occupies the slot the deprecated DeliveryRiderPrompt used to hold. Unlike that
 * prompt this one is dismissable, because forcing it risks a vendor pinning
 * wherever they happen to be sitting rather than their shop. It returns on the
 * next portal load, so the nudge persists without trapping anyone.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import MapPickupPicker from "@/components/shared/MapPickupPicker";

const fetchSettings = async () => {
  const r = await fetch("/api/vendor/settings");
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Failed to load settings");
  return d;
};

export default function PickupPointPrompt({ enabled = true }) {
  const qc = useQueryClient();
  const [point, setPoint] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["vendor-settings"],
    queryFn: fetchSettings,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/vendor/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickup_lat: point.latitude, pickup_lng: point.longitude }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to save");
      return d;
    },
    onSuccess: () => {
      toast.success("Pickup point saved — riders will collect from here.");
      qc.invalidateQueries({ queryKey: ["vendor-settings"] });
    },
    onError: (e) => toast.error(e.message || "Could not save your pickup point."),
  });

  const alreadySet = data?.pickup_lat != null && data?.pickup_lng != null;
  const open = enabled && data && !alreadySet && !dismissed && !save.isSuccess;
  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900"
        >
          <div className="mb-1 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-lg font-bold leading-tight text-gray-900 dark:text-gray-100">
              Where should riders collect?
            </h3>
          </div>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Set the exact spot riders come to. If you are at your shop right now, tap
            <b> Use my current location</b> — otherwise drag the map until the crosshair sits
            on your door.
          </p>

          <MapPickupPicker value={point} onChange={setPoint} disabled={save.isPending} />

          <div className="mt-5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              disabled={save.isPending}
              className="text-xs font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-50 dark:hover:text-gray-200"
            >
              I&apos;ll do this later
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={!point || save.isPending}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save pickup point
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

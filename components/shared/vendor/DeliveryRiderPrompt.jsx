"use client";


// ─── DEPRECATED · in-house delivery ──────────────────────────────────────────
// Superseded by the Fast Link integration (phase 5). Slated for removal once
// every vendor has a Fast Link pickup address and DELIVERY_INHOUSE_ENABLED=false
// has run clean in production. Gate lives at config.delivery.inHouseEnabled.
// orders.rider_id is NOT part of this removal — historical orders keep it.
// Inventory: docs/superpowers/specs/2026-08-08-inhouse-delivery-retirement.md
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Bike, Car, Truck, Loader2, MapPin, Map } from "lucide-react";
import toast from "react-hot-toast";

// Fetches the vendor's current answer. `responded: false` means we still need to ask.
const fetchStatus = async () => {
  const r = await fetch("/api/vendor/delivery-rider");
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Failed to load");
  return d;
};

const OptionCard = ({ active, onClick, icon: Icon, title, subtitle }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-3 w-full text-left rounded-xl border-2 px-4 py-3 transition-all ${
      active
        ? "border-primary bg-primary/5 shadow-sm"
        : "border-gray-200 dark:border-gray-700 hover:border-primary/50 bg-white dark:bg-gray-800"
    }`}
  >
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"}`}>
      <Icon className="w-4 h-4" />
    </div>
    <div className="min-w-0">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
      {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
    </div>
  </button>
);

/**
 * Shown when the vendor portal is unlocked (KYC complete) and the vendor has not
 * yet answered the delivery-rider question. It is non-dismissable by design — it
 * stays until the vendor either fills the quick form or says they have no rider —
 * so it reappears on every login until answered.
 *
 * `enabled` lets the parent suppress the fetch while KYC is still incomplete.
 */
export default function DeliveryRiderPrompt({ enabled = true }) {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["vendor-delivery-rider"],
    queryFn:  fetchStatus,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // null = undecided, true = has rider, false = no rider
  const [hasRider, setHasRider] = useState(null);
  const [vehicle, setVehicle]   = useState(null);
  const [coverage, setCoverage] = useState(null);

  const save = useMutation({
    mutationFn: async (payload) => {
      const r = await fetch("/api/vendor/delivery-rider", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to save");
      return d;
    },
    onSuccess: () => {
      toast.success("Thanks! Your delivery info has been saved.");
      qc.invalidateQueries({ queryKey: ["vendor-delivery-rider"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const open = enabled && data && !data.responded;
  if (!open) return null;

  const canSubmit =
    hasRider === false || (hasRider === true && vehicle && coverage);

  const handleSubmit = () => {
    if (!canSubmit || save.isPending) return;
    save.mutate(
      hasRider
        ? { hasRider: true, vehicle, coverage }
        : { hasRider: false },
    );
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-gray-100 text-lg leading-tight">
              Quick delivery question
            </h3>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 ml-13">
            Do you have your own delivery rider? This helps us route your orders the right way.
          </p>

          {/* Yes / No */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              type="button"
              onClick={() => setHasRider(true)}
              className={`rounded-xl border-2 py-3 text-sm font-bold transition-all ${
                hasRider === true
                  ? "border-primary bg-primary text-white"
                  : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-primary/50"
              }`}
            >
              Yes, I have one
            </button>
            <button
              type="button"
              onClick={() => { setHasRider(false); setVehicle(null); setCoverage(null); }}
              className={`rounded-xl border-2 py-3 text-sm font-bold transition-all ${
                hasRider === false
                  ? "border-primary bg-primary text-white"
                  : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-primary/50"
              }`}
            >
              No, I don&apos;t
            </button>
          </div>

          {/* Follow-up — only when they have a rider */}
          <AnimatePresence>
            {hasRider === true && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 overflow-hidden"
              >
                <div>
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Vehicle type</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <OptionCard active={vehicle === "bike"}    onClick={() => setVehicle("bike")}    icon={Bike} title="Bike" subtitle="Motorbike / bicycle" />
                    <OptionCard active={vehicle === "vehicle"} onClick={() => setVehicle("vehicle")} icon={Car}  title="Vehicle" subtitle="Car / van / truck" />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Delivery coverage</p>
                  <div className="space-y-2.5">
                    <OptionCard active={coverage === "intrastate"} onClick={() => setCoverage("intrastate")} icon={MapPin} title="Within the same state" subtitle="Deliveries inside your state only" />
                    <OptionCard active={coverage === "interstate"} onClick={() => setCoverage("interstate")} icon={Map}    title="Interstate" subtitle="Deliveries across states" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || save.isPending}
            className="mt-6 w-full py-3 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit"}
          </button>
          <p className="text-center text-[11px] text-gray-400 dark:text-gray-500 mt-3">
            You only need to answer this once.
          </p>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

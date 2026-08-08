"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, AlertTriangle, RefreshCw, MapPin, CheckCircle2 } from "lucide-react";
import { NIGERIAN_BANKS, getBankName } from "@/lib/nigerian-banks";
import VariantPresetsManager from "@/components/shared/vendor/VariantPresetsManager";
import MapPickupPicker from "@/components/shared/MapPickupPicker";
import { useAuth } from "@/lib/auth-context";
import { updatePasswordAction } from "@/app/actions/auth";
import toast from "react-hot-toast";

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT Abuja","Gombe",
  "Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos",
  "Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto",
  "Taraba","Yobe","Zamfara",
];

function Section({ title, children }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 space-y-5">
      <h2 className="font-bold text-gray-900 dark:text-gray-100 text-lg border-b border-gray-100 dark:border-gray-700 pb-4">{title}</h2>
      {children}
    </div>
  );
}

async function fetchSettings() {
  const r = await fetch("/api/vendor/settings");
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Failed to load settings");
  return d;
}

async function saveSettings(data) {
  const r = await fetch("/api/vendor/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Save failed");
  return d;
}

// Isolated so that watch() only re-renders this component, not the whole page
function PasswordSection() {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting, errors },
  } = useForm();

  const onSubmit = async (formData) => {
    try {
      const result = await updatePasswordAction({ newPassword: formData.newPassword });
      if (result?.error) throw new Error(result.error);
      reset();
      toast.success("Password updated");
    } catch (e) {
      toast.error(e.message || "Failed to update password. Please try again.");
    }
  };

  return (
    <Section title="Security">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Current Password</label>
          <input
            {...register("currentPassword", { required: "Current password is required" })}
            type="password"
            autoComplete="current-password"
            placeholder="Enter your current password"
            className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">New Password</label>
          <input
            {...register("newPassword", { required: "New password is required", minLength: { value: 8, message: "Min 8 characters" } })}
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Confirm New Password</label>
          <input
            {...register("confirmPassword", {
              required: "Please confirm your password",
              validate: (v) => v === watch("newPassword") || "Passwords do not match",
            })}
            type="password"
            autoComplete="new-password"
            className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-bold px-6 py-2.5 rounded-full hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {isSubmitting ? "Updating…" : "Update Password"}
        </button>
      </form>
    </Section>
  );
}

// Pickup location for Fast Link deliveries. Riders collect orders from here.
//
// Coordinates come from the map, not from the typed address. Mapbox cannot place
// Nigerian street addresses reliably — tested against all 61 verified vendors,
// one produced a result it could locate in the correct state — so server-side
// geocoding now refuses low-confidence results rather than inventing a point.
// The address field is a description for the rider once they arrive.
//
// Rendered with key={settings.id} so it remounts with fresh initial state once
// settings load — no prop→state sync effect needed.
function PickupSection({ settings }) {
  const qc = useQueryClient();
  const [label, setLabel]     = useState(settings.pickup_label   ?? "");
  const [address, setAddress] = useState(settings.pickup_address ?? "");
  const [coords, setCoords]   = useState({ lat: settings.pickup_lat ?? null, lng: settings.pickup_lng ?? null });
  const [dirty, setDirty]     = useState(false);

  const { mutate: savePickup, isPending } = useMutation({
    mutationFn: () =>
      saveSettings({
        pickup_label:   label.trim() || null,
        pickup_address: address.trim(),
        pickup_lat:     coords.lat,
        pickup_lng:     coords.lng,
      }),
    onSuccess: () => {
      toast.success("Pickup location saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["vendor-settings"] });
    },
    onError: (e) => toast.error(e.message || "Failed to save pickup location. Please try again."),
  });

  const hasCoords = coords.lat != null && coords.lng != null;

  return (
    <Section title="Pickup Location">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Where riders collect orders from your store. Set the exact spot on the map — typed
        addresses are not reliable enough to locate a shop in Nigeria, so the map is what we
        send the rider to.
      </p>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Pickup Point
          </label>
          <MapPickupPicker
            value={hasCoords ? { latitude: coords.lat, longitude: coords.lng } : null}
            onChange={({ latitude, longitude }) => {
              setCoords({ lat: latitude, lng: longitude });
              setDirty(true);
            }}
          />
          {hasCoords ? (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 mt-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Pickup point set
            </p>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1.5">
              <MapPin className="w-3.5 h-3.5" /> Set your pickup point before saving.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Address <span className="font-normal text-gray-400">(shown to the rider)</span>
          </label>
          <input
            value={address}
            onChange={(e) => { setAddress(e.target.value); setDirty(true); }}
            placeholder="e.g. 12 Admiralty Way, opposite the filling station"
            className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <p className="text-xs text-gray-400 mt-1.5">
            Landmarks help the rider find you once they arrive. The map pin is what guides them there.
          </p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Label <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            value={label}
            onChange={(e) => { setLabel(e.target.value); setDirty(true); }}
            placeholder="e.g. Main warehouse"
            className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
        <button
          type="button"
          onClick={() => savePickup()}
          disabled={isPending || !dirty || !hasCoords}
          className="flex items-center gap-2 bg-primary text-white text-sm font-bold px-6 py-2.5 rounded-full hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isPending
            ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Save className="w-4 h-4" />
          }
          {isPending ? "Saving…" : "Save Pickup Location"}
        </button>
      </div>
    </Section>
  );
}

// Rendered with key={settings.id} so it remounts with fresh initial state.
const DEFAULT_NOTIF = { new_order: true, order_status: true, payout: true, review: true, low_stock: true };

function VacationSection({ settings }) {
  const qc = useQueryClient();
  const [vacationMode, setVacationMode] = useState(!!settings.vacation_mode);

  const { mutate: toggleVacation, isPending: vacationPending } = useMutation({
    mutationFn: (v) => saveSettings({ vacation_mode: v }),
    onSuccess: (_, v) => {
      toast.success(v ? "Vacation mode enabled — your products are hidden" : "Vacation mode disabled");
      qc.invalidateQueries({ queryKey: ["vendor-settings"] });
    },
    onError: (e) => toast.error(e.message || "Failed to update vacation mode. Please try again."),
  });

  return (
    <Section title="Vacation Mode">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Enable Vacation Mode</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Hides all your products from the store while you are away. Orders already placed are not affected.
          </p>
        </div>
        <label className="relative inline-flex cursor-pointer shrink-0 ml-4">
          <input
            type="checkbox"
            checked={vacationMode}
            disabled={vacationPending}
            onChange={(e) => {
              const v = e.target.checked;
              setVacationMode(v);
              toggleVacation(v);
            }}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500" />
        </label>
      </div>
      {vacationMode && (
        <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mt-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-400">
            Your store is currently in vacation mode. Customers cannot see or purchase your products.
          </p>
        </div>
      )}
    </Section>
  );
}

function NotificationsSection({ settings }) {
  const [notifPrefs, setNotifPrefs] = useState({ ...DEFAULT_NOTIF, ...(settings.notification_preferences ?? {}) });

  const { mutate: saveNotifPrefs } = useMutation({
    mutationFn: (prefs) => saveSettings({ notification_preferences: prefs }),
    onError: (e) => toast.error(e.message || "Failed to save notification preferences. Please try again."),
  });

  return (
    <Section title="Notification Preferences">
      <div className="space-y-4">
        {[
          { id: "new_order",    label: "New Order",           desc: "When a customer places an order" },
          { id: "order_status", label: "Order Status Updates", desc: "Delivery and tracking updates"   },
          { id: "payout",       label: "Payout Notifications", desc: "When funds are transferred"     },
          { id: "review",       label: "Product Reviews",     desc: "When customers leave reviews"    },
          { id: "low_stock",    label: "Low Stock Alerts",    desc: "When stock falls below 5 units"  },
        ].map(({ id, label, desc }) => (
          <div key={id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{desc}</p>
            </div>
            <label className="relative inline-flex cursor-pointer">
              <input
                type="checkbox"
                checked={notifPrefs[id] ?? true}
                onChange={(e) => {
                  const updated = { ...notifPrefs, [id]: e.target.checked };
                  setNotifPrefs(updated);
                  saveNotifPrefs(updated);
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
            </label>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function VendorSettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["vendor-settings"],
    queryFn: fetchSettings,
    staleTime: 60_000,
    retry: false,
  });

  const settings = data?.settings ?? {};

  // ── Shop profile form ──────────────────────────────────────────────────────
  const { register, handleSubmit, reset, formState: { isSubmitting, isDirty } } = useForm();

  useEffect(() => {
    if (settings.id) {
      reset({
        business_name: settings.business_name ?? "",
        description:   settings.description   ?? "",
        phone:         settings.phone          ?? "",
        city:          settings.city           ?? "",
        state:         settings.state          ?? "Lagos",
        return_policy: settings.return_policy  ?? "Returns accepted within 7 days of delivery in original condition.",
      });
    }
  }, [settings.id]); // eslint-disable-line

  const { mutate: saveProfile } = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      toast.success("Shop settings saved");
      qc.invalidateQueries({ queryKey: ["vendor-settings"] });
    },
    onError: (e) => toast.error(e.message || "Failed to save shop settings. Please try again."),
  });

  // ── Bank account form ──────────────────────────────────────────────────────
  const {
    register: regBank,
    handleSubmit: handleBank,
    reset: resetBank,
    setValue: setBankValue,
    formState: { isSubmitting: bankSubmitting, isDirty: bankDirty },
  } = useForm();

  useEffect(() => {
    if (settings.id) {
      resetBank({
        bank_name:           settings.bank_name           ?? "",
        bank_account_number: settings.bank_account_number ?? "",
        bank_code:           settings.bank_code           ?? "",
      });
    }
  }, [settings.id, settings.bank_name, settings.bank_account_number, settings.bank_code]); // eslint-disable-line

  const { mutate: saveBank } = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      toast.success("Bank details updated");
      qc.invalidateQueries({ queryKey: ["vendor-settings"] });
    },
    onError: (e) => toast.error(e.message || "Failed to save bank details. Please try again."),
  });

  // Vacation mode, notifications, and password are handled by isolated,
  // key-remounted child components below (<VacationSection /> etc.)

  if (isLoading) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-6 h-6 text-gray-300 dark:text-gray-600 animate-spin mx-auto mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Shop profile */}
      <Section title="Shop Profile">
        <form onSubmit={handleSubmit((d) => saveProfile(d))} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Shop Name</label>
            <input
              {...register("business_name")}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Shop Bio</label>
            <textarea
              {...register("description")}
              rows={3}
              placeholder="Tell customers about your store…"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Business Phone</label>
              <input
                {...register("phone")}
                type="tel"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">City</label>
              <input
                {...register("city")}
                placeholder="e.g. Lagos"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">State</label>
            <select
              {...register("state")}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white dark:bg-gray-700 dark:text-gray-100"
            >
              {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Return Policy</label>
            <textarea
              {...register("return_policy")}
              rows={3}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !isDirty}
            className="flex items-center gap-2 bg-primary text-white text-sm font-bold px-6 py-2.5 rounded-full hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSubmitting
              ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Save className="w-4 h-4" />
            }
            {isSubmitting ? "Saving…" : "Save Profile"}
          </button>
        </form>
      </Section>

      {/* Bank account */}
      <Section title="Bank Account">
        <p className="text-sm text-gray-500 dark:text-gray-400">Your payouts will be sent to this account.</p>
        <form onSubmit={handleBank((d) => saveBank(d))} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Bank</label>
            <select
              {...regBank("bank_code", { required: "Please select your bank" })}
              onChange={(e) => {
                regBank("bank_code").onChange(e);
                const name = getBankName(e.target.value);
                if (name) setBankValue("bank_name", name, { shouldDirty: true });
              }}
              className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">Select your bank</option>
              {NIGERIAN_BANKS.map((b) => (
                <option key={b.code} value={b.code}>{b.name}</option>
              ))}
            </select>
            <input type="hidden" {...regBank("bank_name")} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">Account Number</label>
            <input
              {...regBank("bank_account_number")}
              type="text"
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit NUBAN"
              className="w-full px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
          </div>
          <button
            type="submit"
            disabled={bankSubmitting || !bankDirty}
            className="flex items-center gap-2 bg-primary text-white text-sm font-bold px-6 py-2.5 rounded-full hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {bankSubmitting
              ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Save className="w-4 h-4" />
            }
            {bankSubmitting ? "Saving…" : "Save Bank Details"}
          </button>
        </form>
      </Section>

      {/* Pickup location (Fast Link delivery) */}
      <PickupSection key={settings.id ?? "loading"} settings={settings} />

      {/* Vacation mode */}
      <VacationSection key={`vac-${settings.id ?? "loading"}`} settings={settings} />

      {/* Notifications */}
      <NotificationsSection key={`notif-${settings.id ?? "loading"}`} settings={settings} />

      {/* Size & option presets */}
      <VariantPresetsManager />

      <PasswordSection />

      {/* Danger zone */}
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <h2 className="font-bold text-red-800 dark:text-red-400">Danger Zone</h2>
        </div>
        <p className="text-sm text-red-700 dark:text-red-400">
          Closing your vendor account will hide all your products from the store. Your account data is retained for 30 days before permanent deletion.
        </p>
        <button className="text-sm font-bold text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 px-5 py-2.5 rounded-xl transition-colors">
          Request Account Closure
        </button>
      </div>
    </div>
  );
}

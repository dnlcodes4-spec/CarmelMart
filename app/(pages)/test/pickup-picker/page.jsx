"use client";

/**
 * /test/pickup-picker — exercise the pickup point picker without a vendor login.
 *
 * Built for a real phone rather than a desktop window. The gestures that matter
 * (drag, pinch, tap-to-locate) cannot be judged with a mouse, and the data cost
 * of the map only shows up on a real connection.
 */

import { useState, useSyncExternalStore } from "react";
import NaijaStates from "naija-state-local-government";
import { MapPin, Smartphone, ListChecks } from "lucide-react";
import MapPickupPicker from "@/components/shared/MapPickupPicker";
import { stateCentre } from "@/lib/geo/nigeria";

/** Real results from auditing all 61 verified vendors. */
const EVIDENCE = [
  { wrote: "47 Alafia Street, Mokola, Ibadan, Oyo State", got: "Alafia Street 47, Lagos 10, Lagos" },
  { wrote: "Soyoye Ashipa Abeokuta, Ogun State",          got: "Asipa Street, Olorunda 23, Osun" },
  { wrote: "Cele Agbede Alabata (FUNAAB), Ogun State",    got: "Stateline Road, Akure South 34, Ondo" },
  { wrote: "Obasanjo, Ogun State",                        got: "Obasanjo Road, Kano Municipal 70, Kano" },
];

/**
 * What the picker decides about image cost on this device. Read through
 * useSyncExternalStore rather than an effect: it is browser-only state, the
 * server snapshot is null, and the cached object keeps the snapshot stable.
 */
let deviceCache = null;
function readDevice() {
  if (deviceCache) return deviceCache;
  if (typeof navigator === "undefined") return null;
  const c = navigator.connection;
  const dpr = window.devicePixelRatio ?? 1;
  const constrained = !!c?.saveData || (c?.effectiveType && /(^|-)2g$|^3g$/.test(c.effectiveType));
  deviceCache = {
    dpr,
    effectiveType: c?.effectiveType ?? "unknown",
    saveData: !!c?.saveData,
    retina: dpr >= 2 && !constrained,
  };
  return deviceCache;
}

function subscribeDevice(onChange) {
  const c = typeof navigator === "undefined" ? null : navigator.connection;
  const handler = () => { deviceCache = null; onChange(); };
  c?.addEventListener?.("change", handler);
  return () => c?.removeEventListener?.("change", handler);
}

const CHECKS = [
  "Drag with one finger — the map should track your finger, not scroll the page",
  "Scroll the page by starting the swipe outside the map",
  "Pinch with two fingers — zoom should be smooth, not stepped",
  "Lift one finger mid-pinch — the map must not jump",
  "Tap “Use my current location” — check the accuracy warning if it appears",
  "Search a landmark and pick a result — the map jumps, you confirm by eye",
  "Switch to Satellite — can you recognise the building?",
  "Set the state below to somewhere you are not, and watch for the mismatch warning",
  "Tab to the map and use the arrow keys",
];

export default function PickupPickerTestPage() {
  const [point, setPoint] = useState(null);
  const [state, setState] = useState("Ogun");
  const [disabled, setDisabled] = useState(false);
  const device = useSyncExternalStore(subscribeDevice, readDevice, () => null);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <MapPin className="h-6 w-6 text-primary" /> Pickup point picker
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-gray-600">
          The real component from vendor settings. Open this on a phone — the gestures are the
          whole point and a mouse cannot tell you whether they feel right.
        </p>

        {/* ── Scenario ─────────────────────────────────────────────────────── */}
        <div className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-100 bg-white p-4">
          <label className="text-xs font-semibold text-gray-700">
            Registered state
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal"
            >
              {NaijaStates.states().map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <p className="max-w-xs text-[11px] text-gray-500">
            Sets where the map opens and which state the point is checked against. Pick one you
            are <b>not</b> in to see the mismatch warning.
          </p>
          <label className="ml-auto flex items-center gap-2 text-xs font-semibold text-gray-700">
            <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
            Disabled (saving)
          </label>
        </div>

        <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-5">
          <MapPickupPicker
            key={state}
            value={point}
            onChange={setPoint}
            initialCentre={stateCentre(state)}
            expectedState={state}
            disabled={disabled}
          />
        </div>

        {/* ── What gets stored ─────────────────────────────────────────────── */}
        <div className="mt-4 overflow-x-auto rounded-2xl bg-gray-900 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
            Saved to vendors.pickup_lat / pickup_lng
          </p>
          <pre className="font-mono text-[11px] leading-relaxed text-green-300">
{JSON.stringify(
  point
    ? { pickup_lat: point.latitude, pickup_lng: point.longitude, coordinates: `${point.latitude},${point.longitude}` }
    : { pickup_lat: null, pickup_lng: null },
  null, 2)}
          </pre>
          <p className="mt-2 text-[11px] text-gray-400">
            The <code>coordinates</code> string is the exact shape Fast Link expects.
          </p>
        </div>

        {/* ── This device ──────────────────────────────────────────────────── */}
        <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <Smartphone className="h-4 w-4 text-primary" /> This device
          </p>
          {device ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
              {[
                ["Pixel ratio", device.dpr],
                ["Connection", device.effectiveType],
                ["Data saver", device.saveData ? "on" : "off"],
                ["Map tiles", device.retina ? "@2x (~185KB)" : "@1x (~5KB)"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="font-mono font-semibold text-gray-900">{String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-[11px] text-gray-400">Reading…</p>
          )}
          <p className="mt-2 text-[11px] text-gray-500">
            Every pan refetches the image, so this is the per-move cost on mobile data.
          </p>
        </div>

        {/* ── Checklist ────────────────────────────────────────────────────── */}
        <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-5">
          <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <ListChecks className="h-4 w-4 text-primary" /> Worth trying on the phone
          </p>
          <ul className="mt-2 space-y-1.5">
            {CHECKS.map((c) => (
              <li key={c} className="flex items-start gap-2 text-xs text-gray-600">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                {c}
              </li>
            ))}
          </ul>
        </div>

        {/* ── Why a map ────────────────────────────────────────────────────── */}
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-bold text-amber-900">Why a map instead of typing an address</p>
          <p className="mt-1 text-xs text-amber-800">
            Across all 61 verified vendors, exactly one address could be geocoded to the correct
            state. These are real results — the vendor named the state and it was still ignored:
          </p>
          <div className="mt-3 space-y-2">
            {EVIDENCE.map((e) => (
              <div key={e.wrote} className="rounded-lg bg-white/70 p-2.5 text-[11px]">
                <p className="text-gray-500">wrote: <span className="text-gray-900">{e.wrote}</span></p>
                <p className="text-gray-500">resolved: <span className="font-semibold text-red-700">{e.got}</span></p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-amber-800">
            Search still uses that same geocoder — but only to move the map. A wrong result costs
            a drag, not a misrouted rider, because you confirm the crosshair by eye before saving.
          </p>
        </div>
      </div>
    </div>
  );
}

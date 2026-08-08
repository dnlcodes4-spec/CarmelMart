"use client";

/**
 * /test/pickup-picker — try the pickup point picker without a vendor login.
 *
 * Renders the real MapPickupPicker and shows exactly what gets stored, alongside
 * the geocoding results that made a map necessary in the first place.
 */

import { useState } from "react";
import { MapPin } from "lucide-react";
import MapPickupPicker from "@/components/shared/MapPickupPicker";

/** Real results from auditing all 61 verified vendors. */
const EVIDENCE = [
  { wrote: "47 Alafia Street, Mokola, Ibadan, Oyo State", got: "Alafia Street 47, Lagos 10, Lagos" },
  { wrote: "Soyoye Ashipa Abeokuta, Ogun State",          got: "Asipa Street, Olorunda 23, Osun" },
  { wrote: "Cele Agbede Alabata (FUNAAB), Ogun State",    got: "Stateline Road, Akure South 34, Ondo" },
  { wrote: "Obasanjo, Ogun State",                        got: "Obasanjo Road, Kano Municipal 70, Kano" },
];

export default function PickupPickerTestPage() {
  const [point, setPoint] = useState(null);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <MapPin className="h-6 w-6 text-primary" /> Pickup point picker
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-gray-600">
          The real component from vendor settings. Drag the map so the crosshair sits on the
          shop, or tap <b>Use my current location</b> — the fastest path for a vendor standing
          in their own store.
        </p>

        <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5">
          <MapPickupPicker value={point} onChange={setPoint} />
        </div>

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
            Server-side geocoding now rejects results like these instead of storing them, so a
            vendor with no pin gets no pickup point rather than one in the wrong city.
          </p>
        </div>
      </div>
    </div>
  );
}

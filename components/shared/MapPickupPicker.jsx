"use client";

/**
 * MapPickupPicker — choose a pickup point by placing it on a map.
 *
 * Why a map and not the address autocomplete: Mapbox's street-level coverage for
 * Nigeria outside Lagos is not good enough to resolve vendor addresses. Tested
 * against all 61 verified vendors, exactly one produced a result Mapbox could
 * place in the right state; addresses in Ibadan and Abeokuta resolved to Lagos
 * streets with high confidence. Coordinates chosen on a map do not depend on that
 * coverage at all.
 *
 * Built on the Static Images API rather than mapbox-gl: no new dependency (the
 * dependency tree cannot currently resolve one), and a single image is far kinder
 * to a mobile connection than streaming vector tiles.
 *
 * The fastest path is "Use my current location" — a vendor standing in their shop
 * gets an exact point with no searching. The map is there to confirm and adjust.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Crosshair, LocateFixed, Plus, Minus, Loader2, AlertCircle } from "lucide-react";
import { panByPixels } from "@/lib/geo/mercator";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Roughly central Nigeria — only used when we have nothing better to show.
const FALLBACK = { lng: 7.4913, lat: 9.0579 };
const MIN_ZOOM = 4;
const MAX_ZOOM = 18;
const DEFAULT_ZOOM = 16; // close enough to distinguish buildings
const HEIGHT = 280;

const round6 = (n) => Math.round(n * 1e6) / 1e6;

export default function MapPickupPicker({ value = null, onChange, disabled = false }) {
  const hasValue = Number.isFinite(value?.latitude) && Number.isFinite(value?.longitude);

  const [center, setCenter] = useState(
    hasValue ? { lng: value.longitude, lat: value.latitude } : FALLBACK,
  );
  const [zoom, setZoom] = useState(hasValue ? DEFAULT_ZOOM : 5);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState(null);       // live pixel offset while dragging
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);

  const boxRef = useRef(null);
  const dragStart = useRef(null);

  // Request the image at the element's own pixel width so one screen pixel is one
  // image pixel — otherwise every drag would be scaled and the pin would drift.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(1280, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // No prop→state sync effect: the initial centre comes from the useState
  // initialiser, every later move goes through commit() which sets it, and the
  // parent remounts this component on key={settings.id} when fresh data arrives.

  const commit = useCallback((next) => {
    setCenter(next);
    onChange?.({ latitude: round6(next.lat), longitude: round6(next.lng) });
  }, [onChange]);

  // ── Drag to pan ───────────────────────────────────────────────────────────
  const onPointerDown = (e) => {
    if (disabled) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, dy: 0 });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragStart.current) return;
    setDrag({ dx: e.clientX - dragStart.current.x, dy: e.clientY - dragStart.current.y });
  };

  const onPointerUp = () => {
    if (!dragStart.current || !drag) { dragStart.current = null; setDrag(null); return; }
    commit(panByPixels(center.lng, center.lat, drag.dx, drag.dy, zoom));
    dragStart.current = null;
    setDrag(null);
  };

  const changeZoom = (delta) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
    setZoom(next);
    // Zooming does not move the point, but it does confirm it as the choice.
    if (hasValue) onChange?.({ latitude: round6(center.lat), longitude: round6(center.lng) });
  };

  const locate = () => {
    if (!navigator.geolocation) { setLocateError("This browser cannot share your location."); return; }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setZoom(DEFAULT_ZOOM);
        commit({ lng: pos.coords.longitude, lat: pos.coords.latitude });
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Drag the map to your shop instead."
            : "Could not get your location. Drag the map to your shop instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  if (!TOKEN) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        Map is unavailable — <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> is not set.
      </div>
    );
  }

  const src = width
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
      `${center.lng},${center.lat},${zoom},0/${width}x${HEIGHT}@2x` +
      `?access_token=${TOKEN}&attribution=false&logo=false`
    : null;

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className={`relative overflow-hidden rounded-xl border border-gray-200 bg-gray-100 select-none ${
          disabled ? "opacity-60" : "cursor-grab active:cursor-grabbing"
        }`}
        style={{ height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt="Map around your pickup point"
            width={width}
            height={HEIGHT}
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            // Follow the finger during the drag; the real move commits on release.
            style={drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
          />
        )}

        {/* Fixed crosshair — the centre of the map is the chosen point. Easier to
            aim on a phone than dragging a small marker. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Crosshair className="h-8 w-8 text-primary drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" strokeWidth={2.5} />
        </div>

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          {[["+", 1, Plus], ["−", -1, Minus]].map(([label, delta, Icon]) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => changeZoom(delta)}
              aria-label={delta > 0 ? "Zoom in" : "Zoom out"}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/95 shadow-sm hover:bg-white disabled:opacity-50"
            >
              <Icon className="h-4 w-4 text-gray-700" />
            </button>
          ))}
        </div>

        <p className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
          Drag the map so the crosshair sits on your shop
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={locate}
          disabled={disabled || locating}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
          {locating ? "Finding you…" : "Use my current location"}
        </button>

        {hasValue ? (
          <span className="font-mono text-[11px] text-gray-500">
            {round6(value.latitude)}, {round6(value.longitude)}
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">No pickup point set yet</span>
        )}
      </div>

      {locateError && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {locateError}
        </p>
      )}
    </div>
  );
}

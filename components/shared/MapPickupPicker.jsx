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
import { panByPixels, pointerDistance, zoomForPinch } from "@/lib/geo/mercator";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Roughly central Nigeria — only used when we have nothing better to show.
const FALLBACK = { lng: 7.4913, lat: 9.0579 };
const MIN_ZOOM = 4;
const MAX_ZOOM = 18;
const DEFAULT_ZOOM = 16; // close enough to distinguish buildings
const HEIGHT = 280;
// Map fetched beyond the frame on every side, so a drag reveals real map instead
// of the empty background it used to expose.
const PAD = 96;
const MAX_STATIC = 1280; // Mapbox Static Images API limit per side

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * @param {object}   props
 * @param {object}  [props.value]        { latitude, longitude } already chosen
 * @param {Function} props.onChange      called with { latitude, longitude }
 * @param {object}  [props.initialCentre] where to open when nothing is chosen yet —
 *                                       e.g. the centre of the customer's state, so
 *                                       they are not panning across the country
 * @param {boolean} [props.disabled]
 */
export default function MapPickupPicker({ value = null, onChange, initialCentre = null, disabled = false }) {
  const hasValue = Number.isFinite(value?.latitude) && Number.isFinite(value?.longitude);
  const opening = hasValue
    ? { lng: value.longitude, lat: value.latitude }
    : (initialCentre ?? FALLBACK);

  const [center, setCenter] = useState(opening);
  // Country-wide when we have nothing; state-level when we know the state; close
  // in once an actual point exists.
  const [zoom, setZoom] = useState(hasValue ? DEFAULT_ZOOM : initialCentre ? 11 : 5);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState(null);       // live pixel offset while dragging
  const [painted, setPainted] = useState(null); // last image src known to be on screen
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);

  const boxRef = useRef(null);
  const dragStart = useRef(null);
  const pointers = useRef(new Map()); // every finger currently down
  const pinch = useRef(null);         // { startDistance, startZoom } while pinching

  // Request the image at the element's own pixel width so one screen pixel is one
  // image pixel — otherwise every drag would be scaled and the pin would drift.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Leave room for the overscan so the fetched image never exceeds the API limit.
    const measure = () => setWidth(Math.min(MAX_STATIC - PAD * 2, Math.round(el.clientWidth)));
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

  // ── Gestures ──────────────────────────────────────────────────────────────
  // One finger pans, two pinch. Pointer Events give us both, but only if the
  // element opts out of the browser's gesture handling — see touchAction below.

  const onPointerDown = (e) => {
    if (disabled) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { startDistance: pointerDistance(a, b), startZoom: zoom };
      // A second finger converts the gesture; the pan in progress is abandoned
      // rather than committed, so pinching never nudges the point.
      dragStart.current = null;
      setDrag(null);
      return;
    }
    if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY };
      setDrag({ dx: 0, dy: 0 });
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      setZoom(zoomForPinch(pinch.current.startZoom, pinch.current.startDistance,
        pointerDistance(a, b), { min: MIN_ZOOM, max: MAX_ZOOM }));
      return;
    }
    if (!dragStart.current) return;
    setDrag({ dx: e.clientX - dragStart.current.x, dy: e.clientY - dragStart.current.y });
  };

  /** @param {boolean} keep commit the gesture, or discard it */
  const endPointer = (e, keep) => {
    pointers.current.delete(e.pointerId);

    if (pinch.current) {
      if (pointers.current.size >= 2) return;
      pinch.current = null;
      // Belt and braces: onPointerDown already cleared this when the second
      // finger landed, so a remaining finger cannot pan from a stale origin.
      dragStart.current = null;
      setDrag(null);
      // The zoom already changed live; confirm the point as the choice.
      if (keep && hasValue) onChange?.({ latitude: round6(center.lat), longitude: round6(center.lng) });
      return;
    }

    if (!dragStart.current || !drag) { dragStart.current = null; setDrag(null); return; }
    if (keep) commit(panByPixels(center.lng, center.lat, drag.dx, drag.dy, zoom));
    dragStart.current = null;
    setDrag(null);
  };

  const onPointerUp = (e) => endPointer(e, true);

  // A cancelled gesture must DISCARD, never commit. The browser fires
  // pointercancel when it claims a gesture for itself; treating that like a
  // finished drag saved a half-finished pan, so scrolling the page past the map
  // silently moved the vendor's pickup point.
  const onPointerCancel = (e) => endPointer(e, false);

  const changeZoom = (delta) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom) + delta));
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

  // Overscan: fetch PAD extra pixels on every side and inset the image, so the
  // frame always has map under it while the finger drags.
  const imgW = width ? width + PAD * 2 : 0;
  const imgH = HEIGHT + PAD * 2;
  // Pinch produces a fractional zoom; trim it so tiny wobbles don't refetch.
  const zoomParam = Math.round(zoom * 100) / 100;
  const src = width
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
      `${center.lng},${center.lat},${zoomParam},0/${imgW}x${imgH}@2x` +
      `?access_token=${TOKEN}&attribution=false&logo=false`
    : null;
  const stale = painted && painted !== src ? painted : null;

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className={`relative overflow-hidden rounded-xl border border-gray-200 bg-gray-100 select-none ${
          disabled ? "opacity-60" : "cursor-grab active:cursor-grabbing"
        }`}
        // touchAction: none opts this element out of the browser's own gesture
        // handling. Without it a phone treats the drag as a page scroll, stops
        // sending pointermove and fires pointercancel — the map followed the
        // finger for a few pixels and then died.
        style={{ height: HEIGHT, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {src && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: -PAD,
              top: -PAD,
              width: imgW,
              height: imgH,
              // Follow the finger during the drag; the real move commits on release.
              transform: drag ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
            }}
          >
            {/* The tile already on screen, held until its replacement paints —
                otherwise the frame goes blank on every pan over a slow connection. */}
            {stale && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={stale}
                alt=""
                aria-hidden="true"
                width={imgW}
                height={imgH}
                draggable={false}
                className="absolute inset-0"
              />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="Map around your pickup point"
              width={imgW}
              height={imgH}
              draggable={false}
              onLoad={() => setPainted(src)}
              className={`absolute inset-0 transition-opacity duration-200 ${
                painted === src ? "opacity-100" : "opacity-0"
              }`}
            />
          </div>
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

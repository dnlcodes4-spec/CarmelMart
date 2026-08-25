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
import { Crosshair, LocateFixed, Plus, Minus, Loader2, AlertCircle, Search, Layers, MapPin, X } from "lucide-react";
import { panByPixels, pointerDistance, zoomForPinch } from "@/lib/geo/mercator";
import { sameState } from "@/lib/geo/nigeria";

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

const STYLES = {
  // Street data outside Lagos is thin — often nothing on screen to recognise.
  streets: { id: "streets-v12", label: "Map" },
  // Satellite shows the actual roof and compound, which is what a vendor knows.
  satellite: { id: "satellite-streets-v12", label: "Satellite" },
};

// A single view costs ~185KB at @2x on streets versus ~5KB at @1x, and every pan
// refetches. That is real money on Nigerian mobile data, so ask for the retina
// image only when the device wants it and the connection is not constrained.
function wantsHiDpi() {
  if (typeof window === "undefined") return false;
  if ((window.devicePixelRatio ?? 1) < 2) return false;
  const c = navigator.connection;
  if (c?.saveData) return false;
  if (c?.effectiveType && /(^|-)2g$|^3g$/.test(c.effectiveType)) return false;
  return true;
}

/** Metres of GPS error beyond which a fix is too vague to accept unquestioned. */
const ACCURACY_LIMIT_M = 150;

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * @param {object}   props
 * @param {object}  [props.value]        { latitude, longitude } already chosen
 * @param {Function} props.onChange      called with { latitude, longitude }
 * @param {object}  [props.initialCentre] where to open when nothing is chosen yet —
 *                                       e.g. the centre of the vendor's state, so
 *                                       they are not panning across the country
 * @param {string}  [props.expectedState] the state we already believe they are in;
 *                                       a point landing elsewhere is queried rather
 *                                       than silently accepted
 * @param {boolean} [props.disabled]
 */
export default function MapPickupPicker({ value = null, onChange, initialCentre = null, expectedState = null, disabled = false }) {
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
  const [styleKey, setStyleKey] = useState("streets");
  const [imgFailed, setImgFailed] = useState(false);
  const [touched, setTouched] = useState(false);  // hide the hint once they engage
  const [place, setPlace] = useState(null);       // { label, state } for the centre
  const [accuracy, setAccuracy] = useState(null); // metres, from the last GPS fix
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
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

  // ── Describing the chosen point ───────────────────────────────────────────
  // Forward geocoding is what failed us: text in, wrong coordinates out. Reverse
  // is the opposite operation and is reliable — a point always knows which
  // region contains it. Used for display only and never stored, so the default
  // (temporary) Mapbox terms are the correct ones here.
  useEffect(() => {
    if (!TOKEN || drag) return;   // don't chase the map while a finger is down
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://api.mapbox.com/search/geocode/v6/reverse?latitude=${center.lat}` +
          `&longitude=${center.lng}&limit=1&access_token=${TOKEN}`,
          { signal: ctrl.signal },
        );
        if (!r.ok) return;
        const d = await r.json();
        const f = d?.features?.[0]?.properties;
        if (!f) { setPlace(null); return; }
        setPlace({ label: f.full_address ?? f.name ?? null, state: f.context?.region?.name ?? null });
      } catch { /* a description is a nicety; never surface a failure for it */ }
    }, 700);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [center.lat, center.lng, drag]);

  // ── Search, to move the map only ──────────────────────────────────────────
  // The vendor still confirms visually against the crosshair, so a bad match is
  // harmless here — it costs a drag, not a misrouted rider. That is what makes
  // search usable for navigation even though it was unusable as a source of truth.
  useEffect(() => {
    const q = query.trim();
    if (!TOKEN || q.length < 3) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(
          `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}` +
          `&country=ng&limit=5&autocomplete=true&access_token=${TOKEN}`,
          { signal: ctrl.signal },
        );
        const d = r.ok ? await r.json() : null;
        setResults((d?.features ?? []).map((f) => ({
          id: f.properties?.mapbox_id ?? f.id,
          label: f.properties?.full_address ?? f.properties?.name ?? "Unnamed place",
          lng: f.geometry?.coordinates?.[0],
          lat: f.geometry?.coordinates?.[1],
        })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)));
      } catch { /* leave the previous results rather than blanking the list */ }
      finally { setSearching(false); }
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  const jumpTo = (r) => {
    setQuery("");
    setResults([]);
    setZoom(15);           // close, but wide enough to recognise the surroundings
    setAccuracy(null);
    commit({ lng: r.lng, lat: r.lat });
  };

  // ── Gestures ──────────────────────────────────────────────────────────────
  // One finger pans, two pinch. Pointer Events give us both, but only if the
  // element opts out of the browser's gesture handling — see touchAction below.

  const onPointerDown = (e) => {
    if (disabled) return;
    setTouched(true);
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

  // Dragging is the only way to move the map, which leaves it unusable without a
  // pointing device. Arrows nudge, +/- zoom.
  const onKeyDown = (e) => {
    if (disabled) return;
    const STEP = e.shiftKey ? 120 : 40;
    const nudge = { ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0], ArrowUp: [0, STEP], ArrowDown: [0, -STEP] }[e.key];
    if (nudge) {
      e.preventDefault();
      setTouched(true);
      commit(panByPixels(center.lng, center.lat, nudge[0], nudge[1], zoom));
      return;
    }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); changeZoom(1); }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); changeZoom(-1); }
  };

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
        setAccuracy(pos.coords.accuracy ?? null);
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
  const retina = wantsHiDpi() ? "@2x" : "";
  const src = width
    ? `https://api.mapbox.com/styles/v1/mapbox/${STYLES[styleKey].id}/static/` +
      `${center.lng},${center.lat},${zoomParam},0/${imgW}x${imgH}${retina}` +
      `?access_token=${TOKEN}&attribution=false&logo=false`
    : null;
  const stale = painted && painted !== src ? painted : null;

  const mismatch = place?.state && expectedState && !sameState(place.state, expectedState);
  const vague = accuracy != null && accuracy > ACCURACY_LIMIT_M;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a landmark to jump there…"
            aria-label="Search for a place to move the map"
            className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-8 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:opacity-50"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setResults([]); }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {(results.length > 0 || searching) && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
              {searching && results.length === 0 && (
                <li className="px-3 py-2.5 text-xs text-gray-400">Searching…</li>
              )}
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(r)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-xs hover:bg-gray-50"
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span className="text-gray-700">{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setStyleKey((k) => (k === "streets" ? "satellite" : "streets"))}
          aria-label={`Switch to ${styleKey === "streets" ? "satellite" : "map"} view`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Layers className="h-3.5 w-3.5" />
          {STYLES[styleKey === "streets" ? "satellite" : "streets"].label}
        </button>
      </div>

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
        onKeyDown={onKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="application"
        aria-label="Map. Use the arrow keys to move your pickup point, plus and minus to zoom."
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
              onLoad={() => { setPainted(src); setImgFailed(false); }}
              onError={() => setImgFailed(true)}
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
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/95 shadow-sm hover:bg-white disabled:opacity-50"
            >
              <Icon className="h-4 w-4 text-gray-700" />
            </button>
          ))}
        </div>

        {!touched && (
          <p className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
            Drag the map so the crosshair sits on your shop
          </p>
        )}

        {imgFailed && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 p-4 text-center text-xs text-gray-600">
            The map could not load here. Check your connection — or use
            &ldquo;Use my current location&rdquo; below, which does not need it.
          </div>
        )}
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

        {!hasValue && <span className="text-[11px] text-gray-400">No pickup point set yet</span>}
      </div>

      {/* A vendor cannot check "6.925620, 3.755948". They can check a place name,
          which is why the point is described back to them in words. */}
      {hasValue && (
        <p className="text-xs text-gray-600">
          {place?.label
            ? <>Riders will come to <span className="font-medium text-gray-900">{place.label}</span></>
            : "Riders will come to the marked spot."}
        </p>
      )}

      {mismatch && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            This spot looks like it is in <b>{place.state}</b>, but your shop is registered
            in <b>{expectedState}</b>. Check the map before saving — a point in the wrong
            state sends riders to the wrong city.
          </span>
        </p>
      )}

      {vague && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Your phone could only place you within about {Math.round(accuracy)}m. Drag the
            map onto your exact building before saving.
          </span>
        </p>
      )}

      {locateError && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {locateError}
        </p>
      )}
    </div>
  );
}

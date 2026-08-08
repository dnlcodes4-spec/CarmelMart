"use client";

/**
 * MapboxAddressAutocomplete — controlled address field with Mapbox suggestions.
 *
 * Talks to the Mapbox Geocoding v6 "forward" endpoint directly from the browser
 * using the PUBLIC token (NEXT_PUBLIC_MAPBOX_TOKEN). Debounced, keyboard-navigable,
 * Nigeria-biased by default. On pick, reports the chosen address + coordinates.
 *
 * Graceful degradation: with no token configured it renders a plain text input,
 * so callers still capture an address string (the server geocodes it as a
 * fallback). Reused by vendor pickup settings and, later, checkout.
 *
 * Props:
 *   value        current address string (controlled)
 *   onChange     (text) => void        — fired on free typing (clears any pin)
 *   onSelect     ({ address, latitude, longitude }) => void — fired on pick
 *   placeholder, country="ng", disabled
 */

import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const ENDPOINT = "https://api.mapbox.com/search/geocode/v6/forward";
const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

const INPUT_CLASS =
  "w-full pl-10 pr-9 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 dark:bg-gray-700 dark:text-gray-100 " +
  "dark:placeholder:text-gray-500";

export default function MapboxAddressAutocomplete({
  value = "",
  onChange,
  onSelect,
  placeholder = "Start typing an address…",
  country = "ng",
  disabled = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const justSelected = useRef(false);
  const listboxId = "mbx-suggestions";

  // Close the dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced suggestion fetch as `value` changes.
  useEffect(() => {
    if (!TOKEN) return;
    // Skip the fetch that fires right after a pick sets `value` to the full address.
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    const q = (value ?? "").trim();
    if (q.length < MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = new URL(ENDPOINT);
        url.searchParams.set("q", q);
        url.searchParams.set("access_token", TOKEN);
        url.searchParams.set("autocomplete", "true");
        url.searchParams.set("country", country);
        url.searchParams.set("limit", "5");

        const res = await fetch(url);
        const data = await res.json();
        const feats = (data?.features ?? [])
          .map((f) => ({
            id: f.properties?.mapbox_id ?? f.id,
            full:
              f.properties?.full_address ??
              f.properties?.place_formatted ??
              f.properties?.name ??
              "",
            lat: f.geometry?.coordinates?.[1] ?? null,
            lng: f.geometry?.coordinates?.[0] ?? null,
          }))
          .filter((f) => f.full && f.lat != null && f.lng != null);

        setSuggestions(feats);
        setActiveIdx(-1);
        setOpen(feats.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [value, country]);

  function choose(s) {
    justSelected.current = true;
    setOpen(false);
    setSuggestions([]);
    onSelect?.({ address: s.full, latitude: s.lat, longitude: s.lng });
  }

  function onKeyDown(e) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      choose(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // No token → plain input; the server resolves coordinates from the text.
  if (!TOKEN) {
    return (
      <div className="relative">
        <MapPin className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={value ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={INPUT_CLASS}
        />
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <MapPin className="w-4 h-4 text-gray-400 absolute left-3 top-[1.35rem] -translate-y-1/2 pointer-events-none z-10" />
      <input
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className={INPUT_CLASS}
      />
      {loading && (
        <Loader2 className="w-4 h-4 text-gray-400 absolute right-3 top-[1.35rem] -translate-y-1/2 animate-spin" />
      )}

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto"
        >
          {suggestions.map((s, i) => (
            <li key={s.id ?? i} role="option" aria-selected={i === activeIdx}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault() /* keep focus */}
                onClick={() => choose(s)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-start gap-2 transition-colors ${
                  i === activeIdx
                    ? "bg-primary/10 dark:bg-primary/20"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <MapPin className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                <span className="text-gray-700 dark:text-gray-200">{s.full}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

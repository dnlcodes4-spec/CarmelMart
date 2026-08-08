/**
 * lib/geo/mercator.js — Web Mercator conversions for the static-map pickup picker.
 *
 * The picker shows a static map image with a fixed crosshair; dragging pans the
 * centre and the centre is the coordinate we store. Translating a pixel drag into
 * a coordinate change is the only real logic involved, so it lives here as pure
 * functions rather than inside a component — an error here silently places a
 * vendor's pickup point somewhere they never chose.
 *
 * Standard slippy-map tile scheme: the world is 256px square at zoom 0 and
 * doubles with each level.
 */

const TILE_SIZE = 256;

/**
 * Web Mercator cannot represent the poles — it stretches to infinity. This is
 * the conventional cutoff that makes the projection square.
 */
export const MAX_LAT = 85.05112878;

/** Keep a latitude inside the projectable range. */
export function clampLat(lat) {
  return Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
}

const worldSize = (zoom) => TILE_SIZE * 2 ** zoom;

/** Geographic coordinates → absolute world pixel position at `zoom`. */
export function lngLatToWorld(lng, lat, zoom) {
  const scale = worldSize(zoom);
  const s = Math.sin(clampLat(lat) * Math.PI / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** Absolute world pixel position at `zoom` → geographic coordinates. */
export function worldToLngLat(x, y, zoom) {
  const scale = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return {
    lng: (x / scale) * 360 - 180,
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  };
}

/**
 * Move a centre point by a drag measured in screen pixels.
 *
 * Signs follow the gesture, not the axis: dragging the map content left (`dx`
 * negative) reveals what lies to the east, so the centre moves east.
 *
 * @param {number} lng   current centre longitude
 * @param {number} lat   current centre latitude
 * @param {number} dx    horizontal drag in pixels
 * @param {number} dy    vertical drag in pixels
 * @param {number} zoom  current zoom level
 * @returns {{lng: number, lat: number}}
 */
export function panByPixels(lng, lat, dx, dy, zoom) {
  const { x, y } = lngLatToWorld(lng, lat, zoom);
  const scale = worldSize(zoom);
  // Subtracting the drag moves the centre opposite to the content.
  const nx = x - dx;
  const ny = Math.min(scale, Math.max(0, y - dy));
  const next = worldToLngLat(nx, ny, zoom);
  return { lng: next.lng, lat: clampLat(next.lat) };
}

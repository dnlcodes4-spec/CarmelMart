/**
 * lib/geo/nigeria.js — approximate centre of each Nigerian state.
 *
 * Used only to position the map picker before the user starts dragging. These
 * are deliberately static rather than geocoded: the lookup is instant, needs no
 * network call, and cannot repeat the failure that motivated the picker in the
 * first place — Mapbox resolving an Abeokuta address to a Lagos street.
 *
 * Precision is irrelevant here. Landing the map somewhere in the right state is
 * the entire job; the user supplies the precision by dragging.
 */

/** Roughly the geographic centre of the country. */
export const NIGERIA_CENTRE = { lat: 9.0579, lng: 7.4913 };

const STATE_CENTRES = {
  abia:        { lat: 5.4527, lng: 7.5248 },
  adamawa:     { lat: 9.3265, lng: 12.3984 },
  "akwa ibom": { lat: 4.9057, lng: 7.8537 },
  anambra:     { lat: 6.2209, lng: 6.9370 },
  bauchi:      { lat: 10.3158, lng: 9.8442 },
  bayelsa:     { lat: 4.7719, lng: 6.0699 },
  benue:       { lat: 7.3369, lng: 8.7404 },
  borno:       { lat: 11.8846, lng: 13.1520 },
  "cross river": { lat: 5.8702, lng: 8.5988 },
  delta:       { lat: 5.8904, lng: 5.6800 },
  ebonyi:      { lat: 6.2649, lng: 8.0137 },
  edo:         { lat: 6.6342, lng: 5.9304 },
  ekiti:       { lat: 7.7190, lng: 5.3110 },
  enugu:       { lat: 6.5244, lng: 7.5186 },
  gombe:       { lat: 10.2897, lng: 11.1673 },
  imo:         { lat: 5.5720, lng: 7.0588 },
  jigawa:      { lat: 12.2280, lng: 9.5616 },
  kaduna:      { lat: 10.5105, lng: 7.4165 },
  kano:        { lat: 11.7471, lng: 8.5247 },
  katsina:     { lat: 12.3797, lng: 7.6306 },
  kebbi:       { lat: 11.4942, lng: 4.2333 },
  kogi:        { lat: 7.7337, lng: 6.6906 },
  kwara:       { lat: 8.9669, lng: 4.3874 },
  lagos:       { lat: 6.5244, lng: 3.3792 },
  nasarawa:    { lat: 8.4998, lng: 8.1997 },
  niger:       { lat: 9.9309, lng: 5.5983 },
  ogun:        { lat: 7.1608, lng: 3.3476 },
  ondo:        { lat: 7.2508, lng: 5.2103 },
  osun:        { lat: 7.5629, lng: 4.5200 },
  oyo:         { lat: 8.1574, lng: 3.6147 },
  plateau:     { lat: 9.2182, lng: 9.5179 },
  rivers:      { lat: 4.8396, lng: 6.9112 },
  sokoto:      { lat: 13.0059, lng: 5.2476 },
  taraba:      { lat: 7.9994, lng: 10.7740 },
  yobe:        { lat: 12.2939, lng: 11.4390 },
  zamfara:     { lat: 12.1222, lng: 6.2236 },
  fct:         { lat: 9.0765, lng: 7.3986 },
};

/**
 * Aliases for how the state is written in different parts of the app — the
 * vendor settings list says "FCT Abuja", naija-state-local-government says "FCT".
 */
const ALIASES = {
  "fct abuja": "fct",
  abuja: "fct",
  "federal capital territory": "fct",
  // naija-state-local-government spells this with a double s.
  nassarawa: "nasarawa",
};

/**
 * @param {string} name state name in any casing
 * @returns {{lat: number, lng: number}|null} null when unrecognised
 */
export function stateCentre(name) {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return null;
  return STATE_CENTRES[ALIASES[key] ?? key] ?? null;
}

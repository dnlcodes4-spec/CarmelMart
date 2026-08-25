/**
 * Touch dragging on the pickup map.
 *
 * On a phone the browser owns a gesture until an element opts out with
 * touch-action. Without it the browser claims the drag as a page scroll and
 * fires pointercancel mid-gesture — which is why the map barely followed the
 * finger. Worse, cancel was wired to the same handler as pointerup, so an
 * interrupted gesture COMMITTED a half-finished pan: scrolling past the map
 * silently moved the vendor's saved location.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// Read at module scope by the component; without it we render the
// "map unavailable" notice and every gesture test passes vacuously.
vi.hoisted(() => { process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.test-token"; });

import MapPickupPicker from "@/components/shared/MapPickupPicker";

// jsdom implements neither of these; the component uses both.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {} unobserve() {} disconnect() {}
  };
  if (!globalThis.PointerEvent) globalThis.PointerEvent = globalThis.MouseEvent;
  // jsdom reports every element as zero-width, which leaves the component with
  // no image to render and makes the imagery assertions meaningless.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() { return 400; },
  });
});

const AT = { latitude: 6.5244, longitude: 3.3792 };

function setup(props = {}) {
  const onChange = props.onChange ?? vi.fn();
  const { container } = render(
    <MapPickupPicker value={AT} onChange={onChange} {...props} />,
  );
  // The draggable surface is the element carrying the pointer handlers.
  // Selected by role rather than position: the surface is the interactive map,
  // and a positional lookup silently pointed at the search bar the moment one
  // was added above it.
  const surface = container.querySelector('[role="application"]');
  // Guard against the token-missing fallback, which would make every gesture
  // assertion below pass for the wrong reason.
  if (!surface) throw new Error("map surface did not render");
  return { onChange, surface, container };
}

/**
 * fireEvent drives React's synthetic system properly — a hand-built Event does
 * not, and produces tests that pass because nothing happens at all.
 */
const pointer = (el, type, { x = 0, y = 0, id = 1 } = {}) =>
  fireEvent[type](el, { clientX: x, clientY: y, pointerId: id, pointerType: "touch" });

describe("touch gestures", () => {
  it("opts out of browser gesture handling so the map can follow the finger", () => {
    const { surface } = setup();
    expect(surface.style.touchAction).toBe("none");
  });

  it("commits the new location when a drag finishes normally", () => {
    const { surface, onChange } = setup();
    pointer(surface, "pointerDown", { x: 100, y: 100 });
    pointer(surface, "pointerMove", { x: 160, y: 100 });
    pointer(surface, "pointerUp", { x: 160, y: 100 });
    expect(onChange).toHaveBeenCalled();
  });

  it("discards the pan when the browser cancels the gesture", () => {
    const { surface, onChange } = setup();
    pointer(surface, "pointerDown", { x: 100, y: 100 });
    pointer(surface, "pointerMove", { x: 160, y: 100 });
    onChange.mockClear();
    pointer(surface, "pointerCancel", { x: 160, y: 100 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves the map where it started after a cancelled gesture", () => {
    const { surface, container } = setup();
    const before = container.querySelector("img")?.getAttribute("src");
    pointer(surface, "pointerDown", { x: 100, y: 100 });
    pointer(surface, "pointerMove", { x: 200, y: 140 });
    pointer(surface, "pointerCancel", { x: 200, y: 140 });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(before);
  });

  it("ignores drags entirely when disabled", () => {
    const { surface, onChange } = setup({ disabled: true });
    pointer(surface, "pointerDown", { x: 100, y: 100 });
    pointer(surface, "pointerMove", { x: 160, y: 100 });
    pointer(surface, "pointerUp", { x: 160, y: 100 });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("pinch to zoom", () => {
  /** Two fingers, `apart` pixels horizontally, centred on the same spot. */
  const pinchTo = (surface, apart) => {
    pointer(surface, "pointerMove", { x: 200 - apart / 2, y: 140, id: 1 });
    pointer(surface, "pointerMove", { x: 200 + apart / 2, y: 140, id: 2 });
  };

  const startPinch = (surface, apart) => {
    pointer(surface, "pointerDown", { x: 200 - apart / 2, y: 140, id: 1 });
    pointer(surface, "pointerDown", { x: 200 + apart / 2, y: 140, id: 2 });
  };

  const zoomOf = (container) => {
    const src = container.querySelector("img[src]")?.getAttribute("src") ?? "";
    // .../static/<lng>,<lat>,<zoom>,0/<w>x<h>@2x
    const m = src.match(/static\/[-\d.]+,[-\d.]+,([\d.]+),/);
    return m ? Number(m[1]) : null;
  };

  // The requested zoom settles on release, not mid-gesture — see "pinch cost and
  // feedback" below for why the map is no longer refetched on every frame.
  const liftBoth = (surface) => {
    pointer(surface, "pointerUp", { x: 300, y: 140, id: 2 });
    pointer(surface, "pointerUp", { x: 100, y: 140, id: 1 });
  };

  it("zooms in when the fingers spread apart", () => {
    const { surface, container } = setup();
    const before = zoomOf(container);
    startPinch(surface, 100);
    pinchTo(surface, 200);
    liftBoth(surface);
    expect(zoomOf(container)).toBeGreaterThan(before);
  });

  it("zooms out when the fingers come together", () => {
    const { surface, container } = setup();
    const before = zoomOf(container);
    startPinch(surface, 200);
    pinchTo(surface, 100);
    liftBoth(surface);
    expect(zoomOf(container)).toBeLessThan(before);
  });

  it("does not pan the map while pinching", () => {
    const { surface, onChange } = setup();
    startPinch(surface, 100);
    onChange.mockClear();
    pinchTo(surface, 240);
    // Complete the gesture — a commit only happens on release, so stopping at
    // pointermove would assert nothing at all.
    pointer(surface, "pointerUp", { x: 320, y: 140, id: 2 });
    pointer(surface, "pointerUp", { x: 80, y: 140, id: 1 });
    const moved = onChange.mock.calls.some(
      ([c]) => c.latitude !== AT.latitude || c.longitude !== AT.longitude,
    );
    expect(moved).toBe(false);
  });

  it("does not pan when the second finger lifts mid-gesture", () => {
    const { surface, onChange } = setup();
    startPinch(surface, 100);
    pinchTo(surface, 200);
    pointer(surface, "pointerUp", { x: 300, y: 140, id: 2 });
    onChange.mockClear();
    // The remaining finger sweeps far; a stale drag origin would pan wildly.
    pointer(surface, "pointerMove", { x: 20, y: 260, id: 1 });
    pointer(surface, "pointerUp", { x: 20, y: 260, id: 1 });
    const moved = onChange.mock.calls.some(
      ([c]) => c.latitude !== AT.latitude || c.longitude !== AT.longitude,
    );
    expect(moved).toBe(false);
  });
});

describe("map imagery", () => {
  it("renders a map wider than its frame so a drag has real map to move into", () => {
    const { container, surface } = setup();
    const img = container.querySelector("img");
    const frame = Number(String(surface.style.height).replace("px", ""));
    expect(Number(img.getAttribute("height"))).toBeGreaterThan(frame);
  });

  it("keeps the previous map visible until the replacement has loaded", () => {
    const { surface, container } = setup();
    const first = container.querySelector("img");
    const firstSrc = first.getAttribute("src");
    fireEvent.load(first); // the first tile paints

    pointer(surface, "pointerDown", { x: 100, y: 100 });
    pointer(surface, "pointerMove", { x: 180, y: 100 });
    pointer(surface, "pointerUp", { x: 180, y: 100 });

    // The replacement has not fired onLoad, so the old tile must still be shown
    // rather than the frame going blank.
    const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).toContain(firstSrc);
    expect(srcs.some((s) => s !== firstSrc)).toBe(true);
  });

  it("drops the stale tile once the replacement has painted", () => {
    const { surface, container } = setup();
    const first = container.querySelector("img");
    const firstSrc = first.getAttribute("src");
    fireEvent.load(first);

    pointer(surface, "pointerDown", { x: 100, y: 100 });
    pointer(surface, "pointerMove", { x: 180, y: 100 });
    pointer(surface, "pointerUp", { x: 180, y: 100 });

    const fresh = [...container.querySelectorAll("img")].find((i) => i.getAttribute("src") !== firstSrc);
    fireEvent.load(fresh);
    const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).not.toContain(firstSrc);
  });
});

describe("pinch cost and feedback", () => {
  const startPinch = (surface, apart) => {
    pointer(surface, "pointerDown", { x: 200 - apart / 2, y: 140, id: 1 });
    pointer(surface, "pointerDown", { x: 200 + apart / 2, y: 140, id: 2 });
  };
  const pinchTo = (surface, apart) => {
    pointer(surface, "pointerMove", { x: 200 - apart / 2, y: 140, id: 1 });
    pointer(surface, "pointerMove", { x: 200 + apart / 2, y: 140, id: 2 });
  };
  const endPinch = (surface, apart) => {
    pointer(surface, "pointerUp", { x: 200 + apart / 2, y: 140, id: 2 });
    pointer(surface, "pointerUp", { x: 200 - apart / 2, y: 140, id: 1 });
  };
  const srcOf = (c) => c.querySelector("img")?.getAttribute("src");
  const layer = (c) => c.querySelector("img")?.parentElement;

  it("fetches no new map while the fingers are still moving", () => {
    // Each fetch is up to ~185KB. Refetching per pointermove made a one-second
    // pinch cost megabytes and lag behind the fingers.
    const { surface, container } = setup();
    const before = srcOf(container);
    startPinch(surface, 100);
    pinchTo(surface, 140);
    pinchTo(surface, 180);
    pinchTo(surface, 220);
    expect(srcOf(container)).toBe(before);
  });

  it("scales what is already on screen so the pinch is felt immediately", () => {
    const { surface, container } = setup();
    startPinch(surface, 100);
    pinchTo(surface, 200);
    expect(layer(container).style.transform).toMatch(/scale\(/);
  });

  it("scales up when spreading and down when closing", () => {
    const { surface, container } = setup();
    startPinch(surface, 100);
    pinchTo(surface, 200);
    const grown = Number(layer(container).style.transform.match(/scale\(([\d.]+)\)/)[1]);
    expect(grown).toBeGreaterThan(1.5);

    endPinch(surface, 200);
    startPinch(surface, 200);
    pinchTo(surface, 100);
    const shrunk = Number(layer(container).style.transform.match(/scale\(([\d.]+)\)/)[1]);
    expect(shrunk).toBeLessThan(1);
  });

  it("fetches the new zoom exactly once, when the fingers lift", () => {
    const { surface, container } = setup();
    const before = srcOf(container);
    startPinch(surface, 100);
    pinchTo(surface, 200);
    endPinch(surface, 200);
    expect(srcOf(container)).not.toBe(before);
  });

  it("drops the temporary scale once the real map has been requested", () => {
    const { surface, container } = setup();
    startPinch(surface, 100);
    pinchTo(surface, 200);
    endPinch(surface, 200);
    expect(layer(container).style.transform ?? "").not.toMatch(/scale\(/);
  });
});

describe("full-screen map mode", () => {
  const openBtn = (c) => [...c.querySelectorAll("button")]
    .find((b) => /full|bigger|expand/i.test(b.textContent + (b.getAttribute("aria-label") ?? "")));

  it("offers a way into a bigger map", () => {
    const { container } = setup();
    expect(openBtn(container)).toBeTruthy();
  });

  it("takes over the screen when opened", () => {
    const { container } = setup();
    fireEvent.click(openBtn(container));
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("locks the page behind it so the map cannot fight the page scroll", () => {
    const { container } = setup();
    fireEvent.click(openBtn(container));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("gives the page its scroll back on close", () => {
    const { container } = setup();
    fireEvent.click(openBtn(container));
    const done = [...container.querySelectorAll("button")].find((b) => /done/i.test(b.textContent));
    fireEvent.click(done);
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes on Escape", () => {
    const { container } = setup();
    fireEvent.click(openBtn(container));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the point chosen in full screen after closing", () => {
    const { container, onChange } = setup();
    fireEvent.click(openBtn(container));
    const surface = container.querySelector('[role="application"]');
    pointer(surface, "pointerDown", { x: 100, y: 100 });
    pointer(surface, "pointerMove", { x: 190, y: 130 });
    pointer(surface, "pointerUp", { x: 190, y: 130 });
    const last = onChange.mock.calls.at(-1)[0];
    const done = [...container.querySelectorAll("button")].find((b) => /done/i.test(b.textContent));
    fireEvent.click(done);
    expect(last.latitude).toBeDefined();
    expect(onChange.mock.calls.at(-1)[0]).toEqual(last);
  });
});

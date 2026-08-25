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
});

const AT = { latitude: 6.5244, longitude: 3.3792 };

function setup(props = {}) {
  const onChange = props.onChange ?? vi.fn();
  const { container } = render(
    <MapPickupPicker value={AT} onChange={onChange} {...props} />,
  );
  // The draggable surface is the element carrying the pointer handlers.
  const surface = container.firstChild.firstChild;
  // Guard against the token-missing fallback, which would make every gesture
  // assertion below pass for the wrong reason.
  if (!surface || surface.tagName !== "DIV") throw new Error("map surface did not render");
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

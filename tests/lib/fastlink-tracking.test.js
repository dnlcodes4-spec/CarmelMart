/**
 * buildTracking turns an order plus its Fast Link event history into the
 * timeline and delivery block the customer order page renders.
 *
 * Pure — no database, no clock. Everything it needs is passed in.
 */
import { describe, it, expect } from "vitest";
import { buildTracking, TRACKING_STEPS } from "@/lib/fastlink/tracking";

const CREATED = "2026-08-01T09:00:00.000Z";

const ev = (carmel_status, created_at, fastlink_status = "x") =>
  ({ carmel_status, fastlink_status, created_at });

describe("timeline shape", () => {
  it("always returns the five familiar steps in order", () => {
    const { tracking } = buildTracking({ orderStatus: "pending", createdAt: CREATED });
    expect(tracking.map((s) => s.label)).toEqual(TRACKING_STEPS.map((s) => s.label));
  });

  it("marks steps up to the current status as done", () => {
    const { tracking } = buildTracking({ orderStatus: "shipped", createdAt: CREATED });
    expect(tracking.map((s) => s.done)).toEqual([true, true, true, true, false]);
  });

  it("marks nothing done for a cancelled order", () => {
    const { tracking } = buildTracking({ orderStatus: "cancelled", createdAt: CREATED });
    expect(tracking.every((s) => s.done === false)).toBe(true);
  });
});

describe("step timestamps", () => {
  it("dates 'Order Placed' from the order itself, with no events needed", () => {
    const { tracking } = buildTracking({ orderStatus: "pending", createdAt: CREATED });
    expect(tracking[0].at).toBe(CREATED);
  });

  it("dates each step from its matching event", () => {
    const { tracking } = buildTracking({
      orderStatus: "shipped",
      createdAt: CREATED,
      events: [
        ev("confirmed",  "2026-08-01T09:05:00.000Z"),
        ev("processing", "2026-08-01T11:00:00.000Z"),
        ev("shipped",    "2026-08-01T14:30:00.000Z"),
      ],
    });
    expect(tracking[1].at).toBe("2026-08-01T09:05:00.000Z");
    expect(tracking[2].at).toBe("2026-08-01T11:00:00.000Z");
    expect(tracking[3].at).toBe("2026-08-01T14:30:00.000Z");
    expect(tracking[4].at).toBeNull();
  });

  it("uses the EARLIEST matching event, so a flapping status cannot push a step forward", () => {
    const { tracking } = buildTracking({
      orderStatus: "shipped",
      createdAt: CREATED,
      events: [
        ev("shipped", "2026-08-01T14:30:00.000Z", "in_transit"),
        ev("shipped", "2026-08-01T18:00:00.000Z", "postponed"),
        ev("shipped", "2026-08-02T10:00:00.000Z", "out_for_delivery"),
      ],
    });
    expect(tracking[3].at).toBe("2026-08-01T14:30:00.000Z");
  });

  it("finds the earliest even when events arrive out of order", () => {
    const { tracking } = buildTracking({
      orderStatus: "shipped",
      createdAt: CREATED,
      events: [
        ev("shipped", "2026-08-02T10:00:00.000Z"),
        ev("shipped", "2026-08-01T14:30:00.000Z"),
      ],
    });
    expect(tracking[3].at).toBe("2026-08-01T14:30:00.000Z");
  });

  it("leaves steps untimed when there is no history at all", () => {
    const { tracking } = buildTracking({ orderStatus: "shipped", createdAt: CREATED, events: [] });
    expect(tracking[0].at).toBe(CREATED);
    expect(tracking.slice(1).every((s) => s.at === null)).toBe(true);
    expect(tracking.map((s) => s.done)).toEqual([true, true, true, true, false]);
  });

  it("ignores events whose status was never mapped", () => {
    const { tracking } = buildTracking({
      orderStatus: "shipped",
      createdAt: CREATED,
      events: [ev(null, "2026-08-01T12:00:00.000Z", "teleported"), ev("shipped", "2026-08-01T14:30:00.000Z")],
    });
    expect(tracking[3].at).toBe("2026-08-01T14:30:00.000Z");
  });
});

describe("delivery block", () => {
  it("flags a problem and carries customer-facing copy", () => {
    const { delivery } = buildTracking({
      orderStatus: "shipped", createdAt: CREATED, fastlinkStatus: "postponed",
    });
    expect(delivery.isIssue).toBe(true);
    expect(delivery.issue.title).toMatch(/postpone/i);
    expect(delivery.issue.message.length).toBeGreaterThan(0);
  });

  it("reports no problem for a healthy delivery", () => {
    const { delivery } = buildTracking({
      orderStatus: "shipped", createdAt: CREATED, fastlinkStatus: "in_transit",
    });
    expect(delivery.isIssue).toBe(false);
    expect(delivery.issue).toBeNull();
  });

  it("reports no problem for an unrecognised status rather than guessing", () => {
    const { delivery } = buildTracking({
      orderStatus: "shipped", createdAt: CREATED, fastlinkStatus: "teleported",
    });
    expect(delivery.isIssue).toBe(false);
    expect(delivery.issue).toBeNull();
    expect(delivery.fastlinkStatus).toBe("teleported");
  });

  it("reports the most recent event as the last update", () => {
    const { delivery } = buildTracking({
      orderStatus: "shipped", createdAt: CREATED, fastlinkStatus: "in_transit",
      events: [ev("processing", "2026-08-01T11:00:00.000Z"), ev("shipped", "2026-08-01T14:30:00.000Z")],
    });
    expect(delivery.lastUpdate).toBe("2026-08-01T14:30:00.000Z");
  });

  it("has no last update before any event arrives", () => {
    const { delivery } = buildTracking({ orderStatus: "confirmed", createdAt: CREATED });
    expect(delivery.lastUpdate).toBeNull();
  });

  it("passes the dispatch time through", () => {
    const { delivery } = buildTracking({
      orderStatus: "shipped", createdAt: CREATED, dispatchedAt: "2026-08-01T09:20:00.000Z",
    });
    expect(delivery.dispatchedAt).toBe("2026-08-01T09:20:00.000Z");
  });

  it("stays quiet for an order that never went to Fast Link", () => {
    const { delivery } = buildTracking({ orderStatus: "confirmed", createdAt: CREATED });
    expect(delivery.fastlinkStatus).toBeNull();
    expect(delivery.isIssue).toBe(false);
  });
});

describe("robustness", () => {
  it("tolerates being called with nothing but a status", () => {
    expect(() => buildTracking({ orderStatus: "pending" })).not.toThrow();
  });

  it("tolerates a null events list", () => {
    const { tracking } = buildTracking({ orderStatus: "shipped", createdAt: CREATED, events: null });
    expect(tracking).toHaveLength(5);
  });
});

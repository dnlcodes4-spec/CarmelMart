/**
 * describeIssue turns a Fast Link problem state into customer-facing copy.
 *
 * The three issue states all map to carmel "shipped", so without this the
 * customer sees a normal "Out for Delivery" step while their parcel is stuck.
 * Copy is produced server-side; clients only render it.
 */
import { describe, it, expect } from "vitest";
import { describeIssue, FASTLINK_ISSUE_STATUSES, isIssueStatus , needsReview } from "@/lib/fastlink/status";

describe("describeIssue", () => {
  it("returns title and message for every issue status", () => {
    for (const status of FASTLINK_ISSUE_STATUSES) {
      const copy = describeIssue(status);
      expect(copy, `expected copy for "${status}"`).not.toBeNull();
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes the three problems rather than reusing one message", () => {
    const messages = [...FASTLINK_ISSUE_STATUSES].map((s) => describeIssue(s).message);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("names the specific problem for each state", () => {
    expect(describeIssue("postponed").title).toMatch(/postpone/i);
    expect(describeIssue("no_response").title).toMatch(/reach/i);
    expect(describeIssue("failed").title).toMatch(/fail/i);
  });

  it("is case-insensitive, matching toCarmelStatus", () => {
    expect(describeIssue("POSTPONED")).toEqual(describeIssue("postponed"));
  });

  it("returns null for healthy statuses", () => {
    for (const status of ["in_transit", "delivered", "confirmed", "out_for_delivery"]) {
      expect(describeIssue(status), `"${status}" is not a problem`).toBeNull();
    }
  });

  it("returns null for unknown or missing input rather than throwing", () => {
    expect(describeIssue("teleported")).toBeNull();
    expect(describeIssue(null)).toBeNull();
    expect(describeIssue(undefined)).toBeNull();
    expect(describeIssue("")).toBeNull();
  });

  it("agrees with isIssueStatus", () => {
    for (const status of ["postponed", "no_response", "failed", "in_transit", "delivered", "nonsense"]) {
      expect(Boolean(describeIssue(status))).toBe(isIssueStatus(status));
    }
  });

  it("keeps messages free of Fast Link's internal vocabulary", () => {
    for (const status of FASTLINK_ISSUE_STATUSES) {
      const { title, message } = describeIssue(status);
      expect(`${title} ${message}`.toLowerCase()).not.toMatch(/fast ?link|no_response|carmel_status/);
    }
  });
});

describe("statuses that need a human", () => {
  it("treats a Fast Link cancellation as needing review, not as a finished order", () => {
    // Fast Link cancels for operational reasons — no rider, area not covered,
    // address unreachable — and the order is usually still valid. Auto-cancelling
    // it took a paid customer's order away with no refund and no explanation.
    expect(needsReview("cancelled")).toBe(true);
  });

  it("also covers the delivery problems that are not cancellations", () => {
    expect(needsReview("postponed")).toBe(true);
    expect(needsReview("no_response")).toBe(true);
    expect(needsReview("failed")).toBe(true);
  });

  it("leaves a healthy delivery alone", () => {
    for (const s of ["pending", "confirmed", "preparing", "arrived_at_pickup",
                     "in_transit", "out_for_delivery", "delivered"]) {
      expect(needsReview(s), s).toBe(false);
    }
  });

  it("does not trip on an unknown or missing status", () => {
    expect(needsReview("something_new")).toBe(false);
    expect(needsReview(null)).toBe(false);
    expect(needsReview(undefined)).toBe(false);
  });

  it("ignores casing, as the rest of the mapping does", () => {
    expect(needsReview("CANCELLED")).toBe(true);
  });
});

describe("describeIssue — cancellation", () => {
  it("explains a cancellation without promising a refund we have not made", () => {
    const copy = describeIssue("cancelled");
    expect(copy).not.toBeNull();
    expect(copy.title).toBeTruthy();
    expect(copy.message).toBeTruthy();
    // Refunds go through the existing cancel path, which credits the wallet.
    // Saying "refunded" here would be a promise nothing has kept.
    expect(copy.message.toLowerCase()).not.toMatch(/refund(ed)?\b/);
  });

  it("still says nothing for a healthy status", () => {
    expect(describeIssue("in_transit")).toBeNull();
    expect(describeIssue("delivered")).toBeNull();
  });
});

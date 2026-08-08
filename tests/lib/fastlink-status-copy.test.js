/**
 * describeIssue turns a Fast Link problem state into customer-facing copy.
 *
 * The three issue states all map to carmel "shipped", so without this the
 * customer sees a normal "Out for Delivery" step while their parcel is stuck.
 * Copy is produced server-side; clients only render it.
 */
import { describe, it, expect } from "vitest";
import { describeIssue, FASTLINK_ISSUE_STATUSES, isIssueStatus } from "@/lib/fastlink/status";

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

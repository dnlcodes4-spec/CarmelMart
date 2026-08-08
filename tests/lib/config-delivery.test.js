/**
 * In-house rider delivery is still the only working fulfilment path — every
 * order to date has a rider assigned, and Fast Link cannot dispatch until
 * vendors have pickup addresses. So the flag defaults ON and must be switched
 * off deliberately, never by accident or by a typo'd env value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = { ...process.env };

async function loadConfig(value) {
  vi.resetModules();
  delete process.env.DELIVERY_INHOUSE_ENABLED;
  if (value !== undefined) process.env.DELIVERY_INHOUSE_ENABLED = value;
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  return (await import("@/lib/config")).config;
}

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in ORIGINAL)) delete process.env[k];
  Object.assign(process.env, ORIGINAL);
});

describe("config.delivery.inHouseEnabled", () => {
  it("is on by default — retiring delivery must be an explicit act", async () => {
    const config = await loadConfig(undefined);
    expect(config.delivery.inHouseEnabled).toBe(true);
  });

  it("switches off only for the exact string \"false\"", async () => {
    const config = await loadConfig("false");
    expect(config.delivery.inHouseEnabled).toBe(false);
  });

  it("stays on for values that merely look falsy", async () => {
    for (const value of ["0", "no", "off", "FALSE", "", " "]) {
      const config = await loadConfig(value);
      expect(config.delivery.inHouseEnabled, `value ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it("stays on for an explicit \"true\"", async () => {
    const config = await loadConfig("true");
    expect(config.delivery.inHouseEnabled).toBe(true);
  });
});

/**
 * NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_BASE_URL both mean "the site's base URL".
 * Only BASE_URL was set locally, so `npm run build` failed on the missing
 * APP_URL even though the value was sitting right there under another name.
 *
 * config.app.url should accept either, preferring APP_URL.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = { ...process.env };

async function loadConfig(env) {
  vi.resetModules();
  for (const k of ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BASE_URL", "NEXT_PUBLIC_APP_ENV"]) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
  return (await import("@/lib/config")).config;
}

beforeEach(() => { process.env.NEXT_PUBLIC_APP_ENV = "development"; });
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in ORIGINAL)) delete process.env[k];
  Object.assign(process.env, ORIGINAL);
});

describe("config.app.url", () => {
  it("prefers NEXT_PUBLIC_APP_URL when both are set", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_APP_URL:  "https://app.example.com",
      NEXT_PUBLIC_BASE_URL: "https://base.example.com",
      NEXT_PUBLIC_APP_ENV:  "development",
    });
    expect(config.app.url).toBe("https://app.example.com");
  });

  it("falls back to NEXT_PUBLIC_BASE_URL when APP_URL is absent", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_BASE_URL: "https://base.example.com",
      NEXT_PUBLIC_APP_ENV:  "development",
    });
    expect(config.app.url).toBe("https://base.example.com");
  });

  it("falls back to localhost when neither is set", async () => {
    const config = await loadConfig({ NEXT_PUBLIC_APP_ENV: "development" });
    expect(config.app.url).toBe("http://localhost:3000");
  });

  it("ignores an empty APP_URL rather than treating it as a value", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_APP_URL:  "",
      NEXT_PUBLIC_BASE_URL: "https://base.example.com",
      NEXT_PUBLIC_APP_ENV:  "development",
    });
    expect(config.app.url).toBe("https://base.example.com");
  });
});

import { describe, expect, it } from "vitest";
import { countThreads, countX, countHashtags } from "@/lib/platforms/text";
import { validateForPlatform } from "@/lib/platforms/validate";
import { textLimitFor } from "@/lib/platforms/catalog";
import { decrypt, encrypt, pkceChallenge } from "@/lib/crypto";
import { escapeLittleText } from "@/lib/platforms/adapters/linkedin";
import { PlatformError } from "@/lib/platforms/errors";
import { platformFetch } from "@/lib/platforms/http";

const jpeg = { kind: "IMAGE" as const, mimeType: "image/jpeg", sizeBytes: 200_000, width: 1080, height: 1080 };
const mp4 = { kind: "VIDEO" as const, mimeType: "video/mp4", sizeBytes: 5_000_000, durationSec: 30 };

describe("text counting", () => {
  it("weights URLs on X as 23 characters", () => {
    expect(countX("hello https://example.com/a/very/long/path/that/keeps/going")).toBe(6 + 23);
  });
  it("counts emoji by UTF-8 bytes on Threads", () => {
    expect(countThreads("hi 🚀")).toBe(3 + 4);
  });
  it("counts hashtags", () => {
    expect(countHashtags("#one two #three #four_5")).toBe(3);
  });
});

describe("validation", () => {
  it("rejects text-only Instagram posts", () => {
    const v = validateForPlatform("INSTAGRAM", "hello", []);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/needs at least one photo or video/);
  });
  it("accepts the spec example: one image + short text on all four MVP platforms", () => {
    const text = "Excited to announce the launch of my new AI application! 🚀";
    for (const p of ["INSTAGRAM", "THREADS", "X", "LINKEDIN"] as const) {
      expect(validateForPlatform(p, text, [jpeg]).ok, p).toBe(true);
    }
  });
  it("enforces X's limit and the per-account override", () => {
    const long = "a".repeat(300);
    expect(validateForPlatform("X", long, []).ok).toBe(false);
    expect(validateForPlatform("X", long, [], { accountSettings: { maxChars: 4000 } }).ok).toBe(true);
    expect(textLimitFor("X", { maxChars: 4000 })).toBe(4000);
  });
  it("blocks mixing photos and video on X", () => {
    expect(validateForPlatform("X", "hi", [jpeg, mp4]).errors.join()).toMatch(/can't mix/);
  });
  it("blocks video on LinkedIn (not implemented yet)", () => {
    expect(validateForPlatform("LINKEDIN", "hi", [mp4]).ok).toBe(false);
  });
  it("requires exactly one video for a Reel", () => {
    expect(validateForPlatform("INSTAGRAM", "hi", [jpeg], { options: { igFormat: "REEL" } }).ok).toBe(false);
    expect(validateForPlatform("INSTAGRAM", "hi", [mp4], { options: { igFormat: "REEL" } }).ok).toBe(true);
  });
  it("refuses planned platforms", () => {
    expect(validateForPlatform("TIKTOK", "hi", [mp4]).ok).toBe(false);
  });
  it("caps Instagram hashtags at 30", () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(validateForPlatform("INSTAGRAM", tags, [jpeg]).ok).toBe(false);
  });
});

describe("crypto", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("token-123");
    const b = encrypt("token-123");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("token-123");
  });
  it("detects tampering", () => {
    const enc = encrypt("secret");
    const parts = enc.split(".");
    parts[3] = Buffer.from("garbage").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("produces the RFC 7636 PKCE challenge", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("LinkedIn little-text escaping", () => {
  it("escapes reserved characters and keeps hashtags clickable", () => {
    expect(escapeLittleText("Hello (world) @you #launch")).toBe("Hello \\(world\\) \\@you {hashtag|\\#|launch}");
  });
});

describe("platformFetch error classification", () => {
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers })) as typeof fetch;

  it("maps Meta code 190 to an auth error", async () => {
    globalThis.fetch = respond(400, { error: { code: 190, message: "Invalid OAuth access token" } });
    const err = await platformFetch("https://x.test", { platform: "Threads" }).catch((e) => e);
    expect(err).toBeInstanceOf(PlatformError);
    expect(err.kind).toBe("auth");
    expect(err.retryable).toBe(false);
  });
  it("treats 429 as retryable and reads Retry-After", async () => {
    globalThis.fetch = respond(429, { title: "Too Many Requests" }, { "retry-after": "60" });
    const err = await platformFetch("https://x.test", { platform: "X" }).catch((e) => e);
    expect(err.kind).toBe("rate_limit");
    expect(err.retryAfterMs).toBe(60_000);
    expect(err.retryable).toBe(true);
  });
  it("treats network failures as transient with no HTTP status", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const err = await platformFetch("https://x.test", { platform: "X" }).catch((e) => e);
    expect(err.kind).toBe("transient");
    expect(err.httpStatus).toBeUndefined();
  });
});

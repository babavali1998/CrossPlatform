/**
 * Adapter contract tests against a fake HTTP layer. They check that each
 * adapter calls the documented endpoints in the right order with the right
 * parameters. They do not talk to the real platforms.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { threads } from "@/lib/platforms/adapters/threads";
import { instagram } from "@/lib/platforms/adapters/instagram";
import { x } from "@/lib/platforms/adapters/x";
import { linkedin } from "@/lib/platforms/adapters/linkedin";
import type { PublishContext, PublishMedia } from "@/lib/platforms/types";

type Call = { method: string; url: string; body: string };
let calls: Call[] = [];
type Route = [RegExp, string, (c: Call) => { status?: number; json?: unknown; headers?: Record<string, string> }];

function fakeFetch(routes: Route[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : init?.body ? "[binary]" : "";
    const call = { method, url, body };
    calls.push(call);
    const r = routes.find(([re, m]) => m === method && re.test(url));
    if (!r) return new Response(JSON.stringify({ error: { message: `unrouted ${method} ${url}`, code: 100 } }), { status: 400 });
    const res = r[2](call);
    return new Response(res.json === undefined ? null : JSON.stringify(res.json), { status: res.status ?? 200, headers: res.headers });
  }) as typeof fetch;
}

function ctx(over: Partial<PublishContext> = {}): PublishContext & { saved: Record<string, unknown> } {
  const saved: Record<string, unknown> = {};
  const c = {
    account: { id: "acc", externalId: "123", username: "shop", accessToken: "tok", settings: {} },
    text: "Hello world",
    media: [] as PublishMedia[],
    options: {},
    state: {} as Record<string, unknown>,
    saved,
    async saveState(p: Record<string, unknown>) {
      Object.assign(saved, p);
      c.state = { ...c.state, ...p };
    },
    async log() {},
    mediaUrl: async (m: PublishMedia) => `https://cdn.test/${m.key}`,
    jpegUrl: async (m: PublishMedia) => `https://cdn.test/${m.key}.jpg`,
    mediaBytes: async () => Buffer.from("fake-image-bytes"),
    criticalWrite: <T,>(fn: () => Promise<T>) => fn(),
    ...over,
  };
  return c;
}

const img = (id: string): PublishMedia => ({ id, key: `k/${id}.png`, kind: "IMAGE", mimeType: "image/png", sizeBytes: 16 });

beforeEach(() => {
  calls = [];
  process.env.THREADS_GRAPH_HOST = "https://graph.threads.com";
});

describe("Threads", () => {
  it("creates a TEXT container, waits for FINISHED, then publishes", async () => {
    fakeFetch([
      [/\/v1\.0\/123\/threads$/, "POST", () => ({ json: { id: "c1" } })],
      [/\/v1\.0\/c1\?/, "GET", () => ({ json: { status: "FINISHED" } })],
      [/\/threads_publish$/, "POST", () => ({ json: { id: "p1" } })],
      [/\/v1\.0\/p1\?fields=permalink/, "GET", () => ({ json: { permalink: "https://www.threads.com/@shop/post/abc" } })],
    ]);
    const c = ctx();
    const r = await threads.publish(c);
    expect(r).toEqual({ externalId: "p1", url: "https://www.threads.com/@shop/post/abc" });
    expect(calls[0].body).toContain("media_type=TEXT");
    expect(calls[0].body).toContain("text=Hello+world");
    expect(calls.find((x) => x.url.endsWith("threads_publish"))!.body).toBe("creation_id=c1");
    expect(c.saved.containerId).toBe("c1");
  });

  it("reuses a saved container on retry instead of creating another", async () => {
    fakeFetch([
      [/\/v1\.0\/c9\?/, "GET", () => ({ json: { status: "FINISHED" } })],
      [/\/threads_publish$/, "POST", () => ({ json: { id: "p9" } })],
      [/\/v1\.0\/p9\?fields=permalink/, "GET", () => ({ json: {} })],
    ]);
    await threads.publish(ctx({ state: { containerId: "c9" } }));
    expect(calls.some((x) => x.method === "POST" && /\/123\/threads$/.test(x.url))).toBe(false);
  });

  it("reconcile reports an already-published container", async () => {
    fakeFetch([[/\/v1\.0\/c5\?/, "GET", () => ({ json: { status: "PUBLISHED" } })]]);
    const r = await threads.reconcile!(ctx({ state: { containerId: "c5", inFlightAt: "x" } }));
    expect(r).not.toBeNull();
  });
});

describe("Instagram", () => {
  it("builds a carousel from child containers using JPEG urls", async () => {
    let n = 0;
    fakeFetch([
      [/\/123\/media$/, "POST", () => ({ json: { id: `m${++n}` } })],
      [/\/m\d\?fields=status_code/, "GET", () => ({ json: { status_code: "FINISHED" } })],
      [/\/media_publish$/, "POST", () => ({ json: { id: "ig1" } })],
      [/\/ig1\?fields=permalink/, "GET", () => ({ json: { permalink: "https://www.instagram.com/p/xyz/" } })],
    ]);
    const r = await instagram.publish(ctx({ media: [img("a"), img("b")] }));
    expect(r.url).toBe("https://www.instagram.com/p/xyz/");
    const creates = calls.filter((c) => c.method === "POST" && c.url.endsWith("/123/media"));
    expect(creates).toHaveLength(3);
    expect(creates[0].body).toContain("is_carousel_item=true");
    expect(decodeURIComponent(creates[0].body)).toContain("image_url=https://cdn.test/k/a.png.jpg");
    expect(creates[2].body).toContain("media_type=CAROUSEL");
    expect(creates[2].body).toContain("children=m1%2Cm2");
  });
});

describe("X", () => {
  it("uploads media with initialize/append/finalize, then posts with media_ids", async () => {
    fakeFetch([
      [/\/2\/media\/upload\/initialize$/, "POST", () => ({ json: { data: { id: "777" } } })],
      [/\/2\/media\/upload\/777\/append$/, "POST", () => ({ status: 204 })],
      [/\/2\/media\/upload\/777\/finalize$/, "POST", () => ({ json: { data: { id: "777" } } })],
      [/\/2\/tweets$/, "POST", () => ({ status: 201, json: { data: { id: "999" } } })],
    ]);
    const r = await x.publish(ctx({ media: [img("a")] }));
    expect(r).toEqual({ externalId: "999", url: "https://x.com/shop/status/999" });
    const tweet = calls.find((c) => c.url.endsWith("/2/tweets"))!;
    expect(JSON.parse(tweet.body)).toEqual({ text: "Hello world", media: { media_ids: ["777"] } });
    expect(JSON.parse(calls[0].body)).toMatchObject({ media_type: "image/png", media_category: "tweet_image" });
  });

  it("reconcile finds the post from an interrupted attempt", async () => {
    fakeFetch([[/\/2\/users\/123\/tweets\?/, "GET", () => ({ json: { data: [{ id: "555", text: "Hello world https://t.co/abc" }] } })]]);
    const r = await x.reconcile!(ctx({ state: { inFlightAt: new Date().toISOString() } }));
    expect(r).toEqual({ externalId: "555", url: "https://x.com/shop/status/555" });
  });
});

describe("LinkedIn", () => {
  it("uploads the image, then creates the post and reads the URN header", async () => {
    fakeFetch([
      [/\/rest\/images\?action=initializeUpload$/, "POST", () => ({ json: { value: { uploadUrl: "https://upload.test/u1", image: "urn:li:image:1" } } })],
      [/upload\.test\/u1$/, "PUT", () => ({ status: 201 })],
      [/\/rest\/posts$/, "POST", () => ({ status: 201, headers: { "x-restli-id": "urn:li:share:42" } })],
    ]);
    const r = await linkedin.publish(ctx({ media: [img("a")], text: "Launch day #ai" }));
    expect(r.url).toBe("https://www.linkedin.com/feed/update/urn:li:share:42/");
    const post = JSON.parse(calls.find((c) => c.url.endsWith("/rest/posts"))!.body);
    expect(post.author).toBe("urn:li:person:123");
    expect(post.content).toEqual({ media: { id: "urn:li:image:1" } });
    expect(post.commentary).toBe("Launch day {hashtag|\\#|ai}");
  });

  it("can't verify an interrupted create, so it reports unknown", async () => {
    expect(await linkedin.reconcile!(ctx({ state: { inFlightAt: "t" } }))).toBe("unknown");
  });
});

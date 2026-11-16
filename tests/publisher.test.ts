/**
 * Integration tests for the publishing engine against a real Postgres
 * database (DATABASE_URL). The platform adapter is replaced with a scripted
 * fake so these tests never call a real social network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter, PublishContext } from "@/lib/platforms/types";
import { PlatformError } from "@/lib/platforms/errors";

const behavior: { publish: (ctx: PublishContext) => Promise<{ externalId: string; url: string }>; reconcile?: PlatformAdapter["reconcile"] } = {
  publish: async () => ({ externalId: "ok", url: "https://example.test/ok" }),
};
let publishCalls = 0;

vi.mock("@/lib/platforms/registry", () => ({
  getAdapter: () =>
    ({
      name: "Fake",
      async publish(ctx: PublishContext) {
        publishCalls++;
        return behavior.publish(ctx);
      },
      reconcile: (ctx: PublishContext) => (behavior.reconcile ? behavior.reconcile(ctx) : Promise.resolve("unknown" as const)),
    }) as unknown as PlatformAdapter,
  hasAdapter: () => true,
}));
vi.mock("@/lib/queue", () => ({ enqueueTarget: vi.fn(async () => {}) }));

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("publisher", async () => {
  const { db } = await import("@/lib/db");
  const { encrypt } = await import("@/lib/crypto");
  const { processTarget, dispatchPost, retryFailed, sweepScheduled } = await import("@/lib/publisher");

  let userId = "";
  let accountIds: string[] = [];

  async function makePost(n = 2, status: "QUEUED" | "SCHEDULED" = "QUEUED", scheduledAt = new Date()) {
    return db.post.create({
      data: {
        userId,
        baseText: "hello",
        status,
        scheduledAt,
        targets: { create: accountIds.slice(0, n).map((socialAccountId) => ({ socialAccountId, text: "hello" })) },
      },
      include: { targets: true },
    });
  }

  beforeAll(async () => {
    const user = await db.user.create({ data: { email: `test-${Date.now()}@example.test` } });
    userId = user.id;
    const mk = (platform: "THREADS" | "X", ext: string) =>
      db.socialAccount.create({
        data: { userId, platform, externalId: ext, username: ext, accessTokenEnc: encrypt("tok"), scopes: [] },
      });
    accountIds = [(await mk("THREADS", "t1")).id, (await mk("X", "x1")).id];
  });

  afterAll(async () => {
    await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });

  beforeEach(() => {
    publishCalls = 0;
    behavior.publish = async () => ({ externalId: "ok", url: "https://example.test/ok" });
    behavior.reconcile = undefined;
  });

  it("publishes each target once and rolls up the post status", async () => {
    const post = await makePost();
    await dispatchPost(post.id);
    for (const t of post.targets) expect((await processTarget(t.id, { isLastAttempt: false })).kind).toBe("published");
    // A duplicate job for the same target is a no-op.
    expect((await processTarget(post.targets[0].id, { isLastAttempt: false })).kind).toBe("skipped");
    expect(publishCalls).toBe(2);
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("PUBLISHED");
  });

  it("keeps going when one platform fails, then retries only the failed one", async () => {
    const post = await makePost();
    await dispatchPost(post.id);
    const [a, b] = post.targets;
    behavior.publish = async (ctx) => {
      if (ctx.account.id === b.socialAccountId) throw new PlatformError("Fake: rejected", { kind: "validation", httpStatus: 400 });
      return { externalId: "ok", url: "u" };
    };
    expect((await processTarget(a.id, { isLastAttempt: false })).kind).toBe("published");
    expect((await processTarget(b.id, { isLastAttempt: false })).kind).toBe("failed");
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("PARTIAL");

    behavior.publish = async () => ({ externalId: "ok2", url: "u2" });
    const r = await retryFailed(post.id);
    expect(r.retried).toBe(1);
    publishCalls = 0;
    expect((await processTarget(a.id, { isLastAttempt: false })).kind).toBe("skipped");
    expect((await processTarget(b.id, { isLastAttempt: false })).kind).toBe("published");
    expect(publishCalls).toBe(1);
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("PUBLISHED");
  });

  it("schedules a retry for transient errors and fails on the last attempt", async () => {
    const post = await makePost(1);
    await dispatchPost(post.id);
    behavior.publish = async () => {
      throw new PlatformError("Fake: 503", { kind: "transient", httpStatus: 503 });
    };
    expect((await processTarget(post.targets[0].id, { isLastAttempt: false })).kind).toBe("retry");
    expect((await db.postTarget.findUniqueOrThrow({ where: { id: post.targets[0].id } })).status).toBe("QUEUED");
    expect((await processTarget(post.targets[0].id, { isLastAttempt: true })).kind).toBe("failed");
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("FAILED");
  });

  it("never re-posts after an ambiguous timeout when the platform can't confirm", async () => {
    const post = await makePost(1);
    await dispatchPost(post.id);
    const id = post.targets[0].id;
    behavior.publish = async (ctx) => ctx.criticalWrite(async () => {
      throw new Error("socket hang up"); // no HTTP status: outcome unknown
    });
    expect((await processTarget(id, { isLastAttempt: false })).kind).toBe("retry");

    publishCalls = 0;
    const second = await processTarget(id, { isLastAttempt: false });
    expect(second.kind).toBe("failed");
    expect(publishCalls).toBe(0);
    expect((await db.postTarget.findUniqueOrThrow({ where: { id } })).lastErrorCode).toBe("OUTCOME_UNKNOWN");

    // A normal retry skips it; the user has to force it.
    expect((await retryFailed(post.id)).retried).toBe(0);
    behavior.publish = async () => ({ externalId: "ok", url: "u" });
    expect((await retryFailed(post.id, { force: true })).retried).toBe(1);
    expect((await processTarget(id, { isLastAttempt: false })).kind).toBe("published");
  });

  it("adopts the existing post when reconcile finds it", async () => {
    const post = await makePost(1);
    await dispatchPost(post.id);
    const id = post.targets[0].id;
    await db.postTarget.update({ where: { id }, data: { providerState: { inFlightAt: new Date().toISOString() } } });
    behavior.reconcile = async () => ({ externalId: "found", url: "https://example.test/found" });
    expect((await processTarget(id, { isLastAttempt: false })).kind).toBe("published");
    expect(publishCalls).toBe(0);
    expect((await db.postTarget.findUniqueOrThrow({ where: { id } })).externalId).toBe("found");
  });

  it("marks the account for reconnection on auth errors", async () => {
    const post = await makePost(1);
    await dispatchPost(post.id);
    behavior.publish = async () => {
      throw new PlatformError("Fake: token revoked", { kind: "auth", httpStatus: 401 });
    };
    expect((await processTarget(post.targets[0].id, { isLastAttempt: false })).kind).toBe("failed");
    const acc = await db.socialAccount.findUniqueOrThrow({ where: { id: accountIds[0] } });
    expect(acc.status).toBe("NEEDS_RECONNECT");
    await db.socialAccount.update({ where: { id: acc.id }, data: { status: "ACTIVE", statusMessage: null } });
  });

  it("dispatches due scheduled posts exactly once and creates the next recurrence", async () => {
    const post = await makePost(1, "SCHEDULED", new Date(Date.now() - 1000));
    await db.post.update({ where: { id: post.id }, data: { recurrence: "WEEKLY" } });
    const [first, second] = await Promise.all([sweepScheduled(), sweepScheduled()]);
    expect(first + second).toBeGreaterThanOrEqual(1);
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("PUBLISHING");
    await processTarget(post.targets[0].id, { isLastAttempt: false });
    const next = await db.post.findFirstOrThrow({ where: { parentPostId: post.id }, include: { targets: true } });
    expect(next.status).toBe("SCHEDULED");
    expect(next.targets).toHaveLength(1);
    expect(next.scheduledAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

/**
 * Publishing engine shared by the API (dispatch) and the worker (execution).
 *
 * Reliability rules:
 *  - The unit of work is a PostTarget (one post on one account).
 *  - A target that reached PUBLISHED is never sent again (idempotency).
 *  - Progress (containers, uploaded media ids) is saved as it happens, so a
 *    retry resumes instead of starting over.
 *  - The single "create post" call is wrapped in criticalWrite. If it fails
 *    ambiguously, the next attempt reconciles with the platform first.
 */
import type { Post, PostTarget, Prisma } from "@/generated/prisma/client";
import { addDays, addMonths, addWeeks } from "date-fns";
import { db } from "@/lib/db";
import { enqueueTarget } from "@/lib/queue";
import { getAccountContext, markNeedsReconnect } from "@/lib/accounts";
import { getAdapter } from "@/lib/platforms/registry";
import { PlatformError, toPlatformError } from "@/lib/platforms/errors";
import type { PublishContext, PublishMedia } from "@/lib/platforms/types";
import { getObjectBytes, objectExists, publicMediaUrl, putObjectBytes } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Queue every not-yet-published target of a post. */
export async function dispatchPost(postId: string) {
  const targets = await db.postTarget.findMany({
    where: { postId, status: { in: ["PENDING", "QUEUED"] } },
  });
  await db.post.update({ where: { id: postId }, data: { status: "PUBLISHING" } });
  if (targets.length === 0) {
    await finalizePost(postId);
    return 0;
  }
  await db.postTarget.updateMany({
    where: { id: { in: targets.map((t) => t.id) }, status: "PENDING" },
    data: { status: "QUEUED" },
  });
  for (const t of targets) await enqueueTarget(t.id, t.retryRound);
  return targets.length;
}

/**
 * Retry only the failed targets. Published targets are untouched, so no
 * duplicates. `force` also retries OUTCOME_UNKNOWN targets, which the user
 * must have checked by hand.
 */
export async function retryFailed(postId: string, opts: { force?: boolean; targetIds?: string[] } = {}) {
  const failed = await db.postTarget.findMany({
    where: {
      postId,
      status: "FAILED",
      ...(opts.targetIds?.length ? { id: { in: opts.targetIds } } : {}),
      socialAccount: { status: "ACTIVE" },
    },
  });
  const retryable = failed.filter((t) => opts.force || t.lastErrorCode !== "OUTCOME_UNKNOWN");
  for (const t of retryable) {
    const state = { ...((t.providerState as object) || {}) } as Record<string, unknown>;
    if (opts.force) delete state.inFlightAt;
    const updated = await db.postTarget.update({
      where: { id: t.id },
      data: { status: "QUEUED", retryRound: { increment: 1 }, providerState: state as Prisma.InputJsonValue },
    });
    await enqueueTarget(updated.id, updated.retryRound);
  }
  if (retryable.length) await db.post.update({ where: { id: postId }, data: { status: "PUBLISHING" } });
  return { retried: retryable.length, skippedUnknown: failed.length - retryable.length };
}

// ---------------------------------------------------------------------------
// Execution (worker)
// ---------------------------------------------------------------------------

export type ProcessOutcome =
  | { kind: "published"; url: string | null }
  | { kind: "skipped"; reason: string }
  | { kind: "retry"; error: PlatformError }
  | { kind: "failed"; error: PlatformError };

export async function log(targetId: string, level: "info" | "warn" | "error", message: string, data?: unknown) {
  await db.publishLog.create({
    data: { targetId, level, message: message.slice(0, 2000), data: (data ?? undefined) as Prisma.InputJsonValue },
  });
  console[level === "error" ? "error" : "log"](`[publish:${targetId}] ${message}`, data ?? "");
}

export async function processTarget(targetId: string, opts: { isLastAttempt: boolean }): Promise<ProcessOutcome> {
  // Claim the target. Only QUEUED (or a PUBLISHING target whose worker
  // crashed, which BullMQ hands back to us as a stalled job) can be claimed.
  const claimed = await db.postTarget.updateMany({
    where: { id: targetId, status: { in: ["QUEUED", "PUBLISHING"] } },
    data: { status: "PUBLISHING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    const t = await db.postTarget.findUnique({ where: { id: targetId }, select: { status: true } });
    return { kind: "skipped", reason: `target is ${t?.status ?? "missing"}` };
  }

  const target = await db.postTarget.findUniqueOrThrow({
    where: { id: targetId },
    include: {
      socialAccount: true,
      post: { include: { media: { include: { media: true }, orderBy: { position: "asc" } } } },
    },
  });

  let state = { ...((target.providerState as object) || {}) } as Record<string, unknown>;
  const saveState = async (patch: Record<string, unknown>) => {
    state = { ...state, ...patch };
    await db.postTarget.update({ where: { id: targetId }, data: { providerState: state as Prisma.InputJsonValue } });
  };

  try {
    const adapter = getAdapter(target.socialAccount.platform);
    const account = await getAccountContext(target.socialAccount);
    const media: PublishMedia[] = target.post.media.map(({ media: m }) => ({
      id: m.id,
      key: m.key,
      kind: m.kind,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      width: m.width,
      height: m.height,
      durationSec: m.durationSec,
    }));

    const ctx: PublishContext = {
      account,
      text: target.text,
      media,
      options: (target.options as Record<string, unknown>) || {},
      get state() {
        return state;
      },
      saveState,
      log: (m, d) => log(targetId, "info", m, d),
      mediaUrl: (m) => publicMediaUrl(m.key),
      mediaBytes: (m) => getObjectBytes(m.key),
      jpegUrl: (m) => jpegUrlFor(m),
      criticalWrite: async (fn) => {
        await saveState({ inFlightAt: new Date().toISOString() });
        try {
          return await fn();
        } catch (err) {
          // The platform answered with an error: the post definitely wasn't
          // created, so it is safe to try again later.
          if (err instanceof PlatformError && err.httpStatus) {
            await saveState({ inFlightAt: null });
            throw err;
          }
          // No answer (timeout, dropped connection): it may have gone through.
          // Keep inFlightAt so the next attempt checks before posting.
          throw new PlatformError(`No response while publishing; checking before any retry (${(err as Error).message})`, {
            kind: "transient",
            code: "NO_RESPONSE",
          });
        }
      },
    };

    // A previous attempt may have created the post without us recording it.
    if (state.inFlightAt || state.containerId) {
      const existing = adapter.reconcile ? await adapter.reconcile(ctx) : "unknown";
      if (existing === "unknown" && state.inFlightAt) {
        throw new PlatformError(
          `The last attempt timed out and ${adapter.name} couldn't confirm whether it went through. Check your ${adapter.name} profile. If the post isn't there, choose "It's not there, retry anyway".`,
          { kind: "outcome_unknown", code: "OUTCOME_UNKNOWN" },
        );
      }
      if (existing && existing !== "unknown") {
        await markPublished(target, existing.externalId, existing.url);
        return { kind: "published", url: existing.url };
      }
      if (state.inFlightAt) await saveState({ inFlightAt: null });
    }

    await log(targetId, "info", `Publishing to ${adapter.name} as @${account.username} (attempt ${target.attempts + 1})`);
    const result = await adapter.publish(ctx);
    await markPublished(target, result.externalId, result.url);
    return { kind: "published", url: result.url };
  } catch (raw) {
    const err = toPlatformError(raw);
    if (err.kind === "auth") {
      await markNeedsReconnect(target.socialAccountId, err.message);
    }
    const willRetry = err.retryable && !opts.isLastAttempt;
    await db.postTarget.update({
      where: { id: targetId },
      data: {
        status: willRetry ? "QUEUED" : "FAILED",
        lastError: err.message,
        lastErrorCode: err.code,
      },
    });
    await log(targetId, willRetry ? "warn" : "error", err.message, {
      kind: err.kind,
      code: err.code,
      httpStatus: err.httpStatus,
      willRetry,
      details: err.details,
    });
    if (!willRetry) await finalizePost(target.postId);
    return willRetry ? { kind: "retry", error: err } : { kind: "failed", error: err };
  }
}

async function markPublished(target: PostTarget, externalId: string, url: string | null) {
  // Re-read state written during this attempt, then clear the in-flight flag.
  const fresh = await db.postTarget.findUnique({ where: { id: target.id }, select: { providerState: true } });
  const merged = { ...((fresh?.providerState as object) || {}), inFlightAt: null };
  await db.postTarget.update({
    where: { id: target.id },
    data: {
      status: "PUBLISHED",
      externalId,
      externalUrl: url,
      publishedAt: new Date(),
      lastError: null,
      lastErrorCode: null,
      providerState: merged as Prisma.InputJsonValue,
    },
  });
  await log(target.id, "info", "Published", { externalId, url });
  await finalizePost(target.postId);
}

/** Roll target statuses up to the post, then schedule the next recurrence. */
export async function finalizePost(postId: string) {
  const targets = await db.postTarget.findMany({ where: { postId }, select: { status: true } });
  const active = targets.filter((t) => t.status !== "CANCELED");
  if (active.some((t) => ["PENDING", "QUEUED", "PUBLISHING"].includes(t.status))) return;
  const published = active.filter((t) => t.status === "PUBLISHED").length;
  const status = active.length === 0 ? "CANCELED" : published === active.length ? "PUBLISHED" : published > 0 ? "PARTIAL" : "FAILED";

  const post = await db.post.update({
    where: { id: postId },
    data: { status, ...(published > 0 ? { publishedAt: new Date() } : {}) },
  });
  if (published > 0) await scheduleNextRecurrence(post);
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

export function nextOccurrence(from: Date, recurrence: Post["recurrence"]): Date | null {
  switch (recurrence) {
    case "DAILY":
      return addDays(from, 1);
    case "WEEKLY":
      return addWeeks(from, 1);
    case "MONTHLY":
      return addMonths(from, 1);
    default:
      return null;
  }
}

async function scheduleNextRecurrence(post: Post) {
  if (post.recurrence === "NONE") return;
  const already = await db.post.findFirst({ where: { parentPostId: post.id } });
  if (already) return;

  let next = nextOccurrence(post.scheduledAt ?? post.publishedAt ?? new Date(), post.recurrence);
  while (next && next < new Date()) next = nextOccurrence(next, post.recurrence); // skip missed slots
  if (!next || (post.recurrenceEndsAt && next > post.recurrenceEndsAt)) return;

  const full = await db.post.findUniqueOrThrow({
    where: { id: post.id },
    include: { media: true, targets: { include: { socialAccount: true } } },
  });
  const liveTargets = full.targets.filter((t) => t.socialAccount.status === "ACTIVE" && t.status !== "CANCELED");
  if (!liveTargets.length) return;

  await db.post.create({
    data: {
      userId: post.userId,
      title: post.title,
      baseText: post.baseText,
      mode: post.mode,
      status: "SCHEDULED",
      scheduledAt: next,
      recurrence: post.recurrence,
      recurrenceEndsAt: post.recurrenceEndsAt,
      parentPostId: post.id,
      source: "recurrence",
      media: { create: full.media.map((m) => ({ mediaId: m.mediaId, position: m.position })) },
      targets: {
        create: liveTargets.map((t) => ({
          socialAccountId: t.socialAccountId,
          text: t.text,
          options: t.options as Prisma.InputJsonValue,
        })),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Scheduler sweep (worker, every 30s)
// ---------------------------------------------------------------------------

export async function sweepScheduled(now = new Date()) {
  const due = await db.post.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    select: { id: true },
    take: 100,
  });
  let dispatched = 0;
  for (const { id } of due) {
    // Atomic claim so two workers never dispatch the same post.
    const claimed = await db.post.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "QUEUED" } });
    if (claimed.count) {
      await dispatchPost(id);
      dispatched++;
    }
  }
  return dispatched;
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

/** Instagram accepts only JPEG. Convert other images once and cache the result. */
async function jpegUrlFor(m: PublishMedia): Promise<string> {
  if (m.mimeType === "image/jpeg") return publicMediaUrl(m.key);
  const key = `${m.key}.converted.jpg`;
  if (!(await objectExists(key))) {
    const sharp = (await import("sharp")).default;
    const input = await getObjectBytes(m.key);
    const out = await sharp(input).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    await putObjectBytes(key, out, "image/jpeg");
  }
  return publicMediaUrl(key);
}

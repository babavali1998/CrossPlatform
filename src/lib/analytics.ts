import { subDays } from "date-fns";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getAccountContext } from "@/lib/accounts";
import { getAdapter } from "@/lib/platforms/registry";
import { PlatformError } from "@/lib/platforms/errors";

/**
 * Pulls post metrics and follower counts from platforms that expose them.
 * Runs every 6 hours in the worker, or on demand from the Analytics page.
 */
export async function syncAnalytics(opts: { userId?: string; days?: number } = {}) {
  const since = subDays(new Date(), opts.days ?? 30);
  const accounts = await db.socialAccount.findMany({
    where: { status: "ACTIVE", ...(opts.userId ? { userId: opts.userId } : {}) },
  });

  let posts = 0;
  let errors = 0;
  for (const account of accounts) {
    const adapter = getAdapter(account.platform);
    if (!adapter.fetchPostMetrics && !adapter.fetchFollowers) continue;
    let ctx;
    try {
      ctx = await getAccountContext(account);
    } catch {
      errors++;
      continue;
    }

    if (adapter.fetchFollowers) {
      try {
        const followers = await adapter.fetchFollowers(ctx);
        if (typeof followers === "number") {
          await db.followerSnapshot.create({ data: { socialAccountId: account.id, followers } });
        }
      } catch (err) {
        errors++;
        console.warn(`[analytics] followers ${account.platform}/${account.username}:`, (err as Error).message);
      }
    }

    if (adapter.fetchPostMetrics) {
      const targets = await db.postTarget.findMany({
        where: { socialAccountId: account.id, status: "PUBLISHED", publishedAt: { gte: since }, externalId: { not: null } },
        select: { id: true, externalId: true },
      });
      for (const t of targets) {
        try {
          const m = await adapter.fetchPostMetrics(ctx, t.externalId!);
          if (!m) continue;
          await db.metricSnapshot.create({
            data: {
              targetId: t.id,
              views: m.views ?? null,
              likes: m.likes ?? null,
              comments: m.comments ?? null,
              shares: m.shares ?? null,
              reach: m.reach ?? null,
              saves: m.saves ?? null,
              raw: (m.raw ?? undefined) as Prisma.InputJsonValue,
            },
          });
          posts++;
        } catch (err) {
          errors++;
          if (err instanceof PlatformError && err.kind === "rate_limit") break;
          console.warn(`[analytics] post ${t.id}:`, (err as Error).message);
        }
      }
    }
    await db.socialAccount.update({ where: { id: account.id }, data: { lastSyncedAt: new Date() } });
  }
  return { posts, errors };
}

export function engagementRate(m: { views?: number | null; reach?: number | null; likes?: number | null; comments?: number | null; shares?: number | null }) {
  const base = m.reach || m.views;
  if (!base) return null;
  return ((m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0)) / base;
}

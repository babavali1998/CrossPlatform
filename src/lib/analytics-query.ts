import { subDays } from "date-fns";
import type { Platform } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { engagementRate } from "@/lib/analytics";

type Totals = { views: number; likes: number; comments: number; shares: number; reach: number; posts: number };
const empty = (): Totals => ({ views: 0, likes: 0, comments: 0, shares: 0, reach: 0, posts: 0 });

export async function getAnalytics(userId: string, days = 30) {
  const since = subDays(new Date(), days);
  const targets = await db.postTarget.findMany({
    where: { post: { userId }, status: "PUBLISHED", publishedAt: { gte: since } },
    include: {
      socialAccount: { select: { platform: true, username: true } },
      post: { select: { id: true, baseText: true } },
      metrics: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });

  const total = empty();
  const byPlatform = new Map<Platform, Totals>();
  const rows = targets.map((t) => {
    const m = t.metrics[0];
    const p = byPlatform.get(t.socialAccount.platform) ?? empty();
    for (const agg of [total, p]) {
      agg.posts++;
      agg.views += m?.views ?? 0;
      agg.likes += m?.likes ?? 0;
      agg.comments += m?.comments ?? 0;
      agg.shares += m?.shares ?? 0;
      agg.reach += m?.reach ?? 0;
    }
    byPlatform.set(t.socialAccount.platform, p);
    return {
      targetId: t.id,
      postId: t.post.id,
      platform: t.socialAccount.platform,
      username: t.socialAccount.username,
      text: t.text.slice(0, 160),
      url: t.externalUrl,
      publishedAt: t.publishedAt?.toISOString() ?? null,
      hasMetrics: !!m,
      views: m?.views ?? null,
      likes: m?.likes ?? null,
      comments: m?.comments ?? null,
      shares: m?.shares ?? null,
      reach: m?.reach ?? null,
      engagementRate: m ? engagementRate(m) : null,
      interactions: m ? (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) : null,
    };
  });

  const best = rows
    .filter((r) => r.interactions !== null)
    .sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0))
    .slice(0, 10);

  const accounts = await db.socialAccount.findMany({
    where: { userId, status: { not: "REVOKED" } },
    include: { followers: { where: { capturedAt: { gte: since } }, orderBy: { capturedAt: "asc" } } },
  });
  const followers = accounts
    .filter((a) => a.followers.length)
    .map((a) => {
      const first = a.followers[0].followers;
      const last = a.followers[a.followers.length - 1].followers;
      return {
        accountId: a.id,
        platform: a.platform,
        username: a.username,
        current: last,
        change: last - first,
        series: a.followers.map((f) => ({ at: f.capturedAt.toISOString(), followers: f.followers })),
      };
    });

  const er = (t: Totals) => {
    const base = t.reach || t.views;
    return base ? (t.likes + t.comments + t.shares) / base : null;
  };

  return {
    days,
    total: { ...total, engagementRate: er(total) },
    platforms: [...byPlatform.entries()].map(([platform, t]) => ({ platform, ...t, engagementRate: er(t) })),
    best,
    posts: rows,
    followers,
    lastSyncedAt: accounts.map((a) => a.lastSyncedAt).filter(Boolean).sort().pop()?.toISOString() ?? null,
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof getAnalytics>>;

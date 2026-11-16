import { withUser } from "@/lib/api";
import { getAnalytics } from "@/lib/analytics-query";
import { getMaintenanceQueue } from "@/lib/queue";

export const GET = withUser(async (userId, req) => {
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days") || 30)));
  return getAnalytics(userId, days);
});

/** Queue a metrics refresh for this user (runs in the worker). */
export const POST = withUser(async (userId) => {
  await getMaintenanceQueue().add(
    "analytics",
    { kind: "sync-analytics", userId },
    { jobId: `analytics_${userId}_${Math.floor(Date.now() / 60_000)}`, removeOnComplete: true, removeOnFail: true },
  );
  return { queued: true };
});

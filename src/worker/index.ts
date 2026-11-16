/**
 * Background worker: publishes queued targets, dispatches scheduled posts and
 * syncs analytics. Run alongside the web app: `npm run worker`.
 * Vercel functions can't host a long-running BullMQ worker, so deploy this
 * on Railway, Render, Fly.io or any container host (see Dockerfile.worker).
 */
import "dotenv/config";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import {
  MAINTENANCE_QUEUE,
  PUBLISH_QUEUE,
  getMaintenanceQueue,
  redis,
  type MaintenanceJobData,
  type PublishJobData,
} from "@/lib/queue";
import { processTarget, sweepScheduled } from "@/lib/publisher";
import { syncAnalytics } from "@/lib/analytics";
import { PlatformError } from "@/lib/platforms/errors";
import { db } from "@/lib/db";

const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);

/** Exponential backoff (30s, 1m, 2m, 4m, 8m...) unless the platform told us when to come back. */
export function platformBackoff(attemptsMade: number, _type: string | undefined, err?: Error): number {
  if (err instanceof PlatformError && err.retryAfterMs) {
    return Math.min(err.retryAfterMs + 1000 + Math.random() * 5000, 60 * 60_000);
  }
  const base = 30_000 * 2 ** Math.max(0, attemptsMade - 1);
  return Math.min(base, 30 * 60_000) * (0.8 + Math.random() * 0.4);
}

const publishWorker = new Worker<PublishJobData>(
  PUBLISH_QUEUE,
  async (job: Job<PublishJobData>) => {
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const outcome = await processTarget(job.data.targetId, { isLastAttempt });
    if (outcome.kind === "retry") throw outcome.error; // BullMQ schedules the retry
    if (outcome.kind === "failed") throw new UnrecoverableError(outcome.error.message);
    return outcome;
  },
  {
    connection: redis(),
    concurrency,
    settings: { backoffStrategy: platformBackoff },
    // Video processing on Meta can take minutes; keep the lock alive.
    lockDuration: 5 * 60_000,
  },
);

const maintenanceWorker = new Worker<MaintenanceJobData>(
  MAINTENANCE_QUEUE,
  async (job) => {
    if (job.data.kind === "sweep-scheduled") return { dispatched: await sweepScheduled() };
    if (job.data.kind === "sync-analytics") return syncAnalytics({ userId: job.data.userId });
  },
  { connection: redis(), concurrency: 1 },
);

for (const [name, w] of [
  ["publish", publishWorker],
  ["maintenance", maintenanceWorker],
] as const) {
  w.on("failed", (job, err) => console.error(`[${name}] job ${job?.id} failed: ${err.message}`));
  w.on("error", (err) => console.error(`[${name}] worker error:`, err));
}

async function main() {
  const q = getMaintenanceQueue();
  await q.upsertJobScheduler("sweep-scheduled", { every: 30_000 }, { name: "sweep", data: { kind: "sweep-scheduled" } });
  await q.upsertJobScheduler(
    "sync-analytics",
    { every: 6 * 3600_000 },
    { name: "analytics", data: { kind: "sync-analytics" } },
  );
  console.log(`[worker] running (publish concurrency ${concurrency})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function shutdown() {
  console.log("[worker] shutting down");
  await Promise.allSettled([publishWorker.close(), maintenanceWorker.close()]);
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

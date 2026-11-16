import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

export const PUBLISH_QUEUE = "publish";
export const MAINTENANCE_QUEUE = "maintenance";

export type PublishJobData = { targetId: string };
export type MaintenanceJobData = { kind: "sweep-scheduled" | "sync-analytics"; userId?: string };

let connection: IORedis | null = null;
export function redis(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null, // required by BullMQ
    });
  }
  return connection;
}

let publishQueue: Queue<PublishJobData> | null = null;
let maintenanceQueue: Queue<MaintenanceJobData> | null = null;

export function getPublishQueue() {
  publishQueue ??= new Queue<PublishJobData>(PUBLISH_QUEUE, { connection: redis() });
  return publishQueue;
}

export function getMaintenanceQueue() {
  maintenanceQueue ??= new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE, { connection: redis() });
  return maintenanceQueue;
}

export const PUBLISH_ATTEMPTS = 6;

export const publishJobOptions: JobsOptions = {
  attempts: PUBLISH_ATTEMPTS,
  backoff: { type: "platform" }, // see backoffStrategy in src/worker/index.ts
  removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

/**
 * The job id includes the target's retry round. BullMQ ignores a second add
 * with the same id, so double-clicking Publish or a scheduler race can't
 * enqueue a target twice, while an explicit "retry failed" gets a new id.
 */
export function publishJobId(targetId: string, retryRound: number) {
  return `t_${targetId}_r${retryRound}`;
}

export async function enqueueTarget(targetId: string, retryRound: number) {
  await getPublishQueue().add("publish", { targetId }, { ...publishJobOptions, jobId: publishJobId(targetId, retryRound) });
}

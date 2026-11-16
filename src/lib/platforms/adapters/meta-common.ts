import { PlatformError } from "../errors";
import { platformJson, sleep } from "../http";

export type ContainerStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED" | string;

/**
 * Polls a Meta media container (Instagram or Threads) until it is ready.
 * Images are usually ready in seconds; videos can take minutes.
 */
export async function waitForContainer(opts: {
  platform: string;
  getStatus: () => Promise<{ status: ContainerStatus; error?: string }>;
  isVideo: boolean;
  log: (m: string, d?: unknown) => Promise<void>;
}): Promise<ContainerStatus> {
  const deadline = Date.now() + (opts.isVideo ? 10 * 60_000 : 2 * 60_000);
  let delay = opts.isVideo ? 10_000 : 3_000;
  for (;;) {
    const { status, error } = await opts.getStatus();
    if (status === "FINISHED" || status === "PUBLISHED") return status;
    if (status === "ERROR") {
      throw new PlatformError(`${opts.platform}: media processing failed${error ? ` (${error})` : ""}`, {
        kind: "validation",
        code: "MEDIA_PROCESSING_FAILED",
      });
    }
    if (status === "EXPIRED") {
      throw new PlatformError(`${opts.platform}: media container expired before publishing`, {
        kind: "transient",
        code: "CONTAINER_EXPIRED",
      });
    }
    if (Date.now() > deadline) {
      throw new PlatformError(`${opts.platform}: media still processing after waiting; will retry`, {
        kind: "transient",
        code: "PROCESSING_TIMEOUT",
      });
    }
    await opts.log(`Waiting for ${opts.platform} to process media (status ${status})`);
    await sleep(delay);
    delay = Math.min(delay * 1.5, 30_000);
  }
}

export async function metaGet<T>(platform: string, url: string, token: string, params: Record<string, string> = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return platformJson<T>(u.toString(), { platform, headers: { Authorization: `Bearer ${token}` } });
}

export async function metaPost<T>(platform: string, url: string, token: string, params: Record<string, string | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, v);
  return platformJson<T>(url, {
    platform,
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

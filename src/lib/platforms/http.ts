import { PlatformError } from "./errors";

type FetchOpts = RequestInit & { timeoutMs?: number; platform: string };

function retryAfterMs(res: Response): number | undefined {
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (!Number.isNaN(secs)) return secs * 1000;
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  // X: x-rate-limit-reset is a unix timestamp in seconds.
  const reset = res.headers.get("x-rate-limit-reset");
  if (reset && !Number.isNaN(Number(reset))) return Math.max(0, Number(reset) * 1000 - Date.now());
  return undefined;
}

/** Meta Graph error codes: https://developers.facebook.com/docs/graph-api/guides/error-handling */
function classifyMeta(body: unknown): { kind: PlatformError["kind"]; code: string; message: string } | null {
  const err = (body as { error?: Record<string, unknown> })?.error;
  if (!err || typeof err !== "object") return null;
  const code = Number(err.code);
  const sub = err.error_subcode ? `/${err.error_subcode}` : "";
  const message = String(err.error_user_msg || err.message || "Meta API error");
  const label = `META_${code}${sub}`;
  if (code === 190 || code === 102) return { kind: "auth", code: label, message };
  if ([4, 17, 32, 613, 80001, 80002].includes(code)) return { kind: "rate_limit", code: label, message };
  if (code === 10 || (code >= 200 && code < 300)) return { kind: "permission", code: label, message };
  if (err.is_transient === true || code === 1 || code === 2) return { kind: "transient", code: label, message };
  return { kind: "validation", code: label, message };
}

function describe(body: unknown, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === "string") return body.slice(0, 500);
  const b = body as Record<string, unknown>;
  // X v2: { title, detail, errors: [{ message }] }
  const errors = b.errors as Array<{ message?: string; detail?: string }> | undefined;
  return String(
    b.detail || b.message || b.error_description || (errors?.[0]?.message ?? errors?.[0]?.detail) || b.title || fallback,
  ).slice(0, 500);
}

/**
 * fetch() that turns every non-2xx response into a classified PlatformError.
 * Network failures and timeouts become "transient" errors without httpStatus,
 * which is how criticalWrite knows the outcome is ambiguous.
 */
export async function platformFetch(url: string, opts: FetchOpts): Promise<Response> {
  const { timeoutMs = 60_000, platform, ...init } = opts;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new PlatformError(`${platform}: network error (${(err as Error).message})`, {
      kind: "transient",
      code: "NETWORK",
    });
  }
  if (res.ok) return res;

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }

  const meta = classifyMeta(body);
  if (meta) {
    throw new PlatformError(`${platform}: ${meta.message}`, {
      kind: res.status === 429 ? "rate_limit" : meta.kind,
      code: meta.code,
      httpStatus: res.status,
      retryAfterMs: retryAfterMs(res),
      details: body,
    });
  }

  const message = `${platform}: ${describe(body, res.statusText || `HTTP ${res.status}`)}`;
  const base = { httpStatus: res.status, details: body, code: `HTTP_${res.status}` };
  if (res.status === 401) throw new PlatformError(message, { ...base, kind: "auth" });
  if (res.status === 403) throw new PlatformError(message, { ...base, kind: "permission" });
  if (res.status === 429) throw new PlatformError(message, { ...base, kind: "rate_limit", retryAfterMs: retryAfterMs(res) });
  if (res.status >= 500) throw new PlatformError(message, { ...base, kind: "transient" });
  throw new PlatformError(message, { ...base, kind: "validation" });
}

export async function platformJson<T = unknown>(url: string, opts: FetchOpts): Promise<T> {
  const res = await platformFetch(url, opts);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export function form(data: Record<string, string | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v !== undefined) p.set(k, v);
  return p;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function expiresAt(expiresInSec?: number | null): Date | null {
  return expiresInSec ? new Date(Date.now() + expiresInSec * 1000) : null;
}

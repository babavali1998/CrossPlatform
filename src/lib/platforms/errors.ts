export type PlatformErrorKind =
  | "auth" // token invalid/revoked: reconnect needed
  | "permission" // missing scope or app approval
  | "rate_limit"
  | "validation" // content rejected
  | "transient" // 5xx / network: safe to retry
  | "outcome_unknown" // request may have succeeded; don't retry blindly
  | "unsupported"
  | "unknown";

export class PlatformError extends Error {
  kind: PlatformErrorKind;
  code: string;
  httpStatus?: number;
  retryAfterMs?: number;
  details?: unknown;

  constructor(
    message: string,
    opts: { kind: PlatformErrorKind; code?: string; httpStatus?: number; retryAfterMs?: number; details?: unknown },
  ) {
    super(message);
    this.name = "PlatformError";
    this.kind = opts.kind;
    this.code = opts.code ?? opts.kind.toUpperCase();
    this.httpStatus = opts.httpStatus;
    this.retryAfterMs = opts.retryAfterMs;
    this.details = opts.details;
  }

  get retryable(): boolean {
    return this.kind === "transient" || this.kind === "rate_limit";
  }
}

export function toPlatformError(err: unknown): PlatformError {
  if (err instanceof PlatformError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new PlatformError(message, { kind: "unknown", code: "UNKNOWN" });
}

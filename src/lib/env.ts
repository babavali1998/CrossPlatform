import { z } from "zod";

/**
 * Server environment, validated lazily so that `next build` works without
 * every platform credential present. Platform adapters call `requireEnv`
 * for their own keys and the UI reports which platforms are unconfigured.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  // Optional public base URL (CDN). If unset, presigned GET URLs are used.
  S3_PUBLIC_BASE_URL: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function requireEnv(name: string): string {
  const v = optionalEnv(name);
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function appUrl(path = ""): string {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

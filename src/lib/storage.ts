import { GetObjectCommand, PutObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

let client: S3Client | null = null;

export function s3(): S3Client {
  if (client) return client;
  const e = env();
  client = new S3Client({
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT || undefined,
    forcePathStyle: e.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });
  return client;
}

export async function presignUpload(key: string, contentType: string, sizeBytes: number) {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
    { expiresIn: 15 * 60 },
  );
}

/**
 * A URL a platform's servers can fetch the media from. Instagram and Threads
 * download media themselves, so this must be reachable from the public
 * internet (a localhost MinIO is not).
 */
export async function publicMediaUrl(key: string, expiresInSec = 60 * 60 * 6): Promise<string> {
  const base = env().S3_PUBLIC_BASE_URL;
  if (base) return `${base.replace(/\/$/, "")}/${key}`;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }), {
    expiresIn: expiresInSec,
  });
}

export async function getObjectBytes(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  if (!res.Body) throw new Error(`Empty object ${key}`);
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function putObjectBytes(key: string, body: Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function objectExists(key: string): Promise<{ size: number } | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
    return { size: Number(res.ContentLength ?? 0) };
  } catch {
    return null;
  }
}

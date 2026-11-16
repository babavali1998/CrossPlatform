import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError, withUser } from "@/lib/api";
import { objectExists, presignUpload } from "@/lib/storage";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"];
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB (largest any MVP platform accepts)

const createSchema = z.object({
  fileName: z.string().max(255),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
});

/** Step 1: register the file and get a presigned PUT URL for direct upload. */
export const POST = withUser(async (userId, req) => {
  const body = createSchema.parse(await req.json());
  if (!ALLOWED.includes(body.mimeType)) throw new HttpError(400, `Unsupported file type ${body.mimeType}`);
  if (body.sizeBytes > MAX_BYTES) throw new HttpError(400, "File is larger than 1 GB");

  const ext = body.mimeType.split("/")[1].replace("quicktime", "mov").replace("jpeg", "jpg");
  const key = `u/${userId}/${randomUUID()}.${ext}`;
  const media = await db.mediaAsset.create({
    data: {
      userId,
      key,
      kind: body.mimeType.startsWith("video/") ? "VIDEO" : "IMAGE",
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      width: body.width,
      height: body.height,
      durationSec: body.durationSec,
      originalName: body.fileName,
    },
  });
  const uploadUrl = await presignUpload(key, body.mimeType, body.sizeBytes);
  return { media, uploadUrl };
});

/** Step 2: confirm the object landed in storage. */
export const PATCH = withUser(async (userId, req) => {
  const { id } = z.object({ id: z.string() }).parse(await req.json());
  const media = await db.mediaAsset.findFirst({ where: { id, userId } });
  if (!media) throw new HttpError(404, "Media not found");
  const head = await objectExists(media.key);
  if (!head) throw new HttpError(400, "Upload not found in storage");
  if (head.size !== media.sizeBytes) throw new HttpError(400, "Uploaded file size doesn't match");
  const updated = await db.mediaAsset.update({ where: { id }, data: { uploaded: true } });
  return { media: updated };
});

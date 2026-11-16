import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, withUser } from "@/lib/api";
import { adaptPost } from "@/lib/ai";

const schema = z.object({
  text: z.string().min(1).max(10_000),
  tone: z.string().max(200).optional(),
  targets: z.array(z.object({ socialAccountId: z.string(), format: z.string().optional() })).min(1).max(50),
  mediaIds: z.array(z.string()).max(20).default([]),
});

/** Generates per-platform versions. Nothing is published; the user reviews and edits first. */
export const POST = withUser(async (userId, req) => {
  const body = schema.parse(await req.json());
  const accounts = await db.socialAccount.findMany({
    where: { userId, id: { in: body.targets.map((t) => t.socialAccountId) } },
  });
  if (!accounts.length) throw new HttpError(400, "No accounts selected.");
  const media = await db.mediaAsset.findMany({ where: { userId, id: { in: body.mediaIds } } });
  const mediaSummary = media.length
    ? `${media.filter((m) => m.kind === "IMAGE").length} image(s), ${media.filter((m) => m.kind === "VIDEO").length} video(s)`
    : undefined;

  const adaptations = await adaptPost({
    text: body.text,
    tone: body.tone,
    mediaSummary,
    targets: accounts.map((a) => ({
      platform: a.platform,
      settings: a.settings as Record<string, unknown>,
      format: body.targets.find((t) => t.socialAccountId === a.id)?.format,
    })),
  });

  // Same text for every account on the same platform.
  return {
    versions: accounts.map((a) => ({
      ...adaptations.find((x) => x.platform === a.platform)!,
      socialAccountId: a.id,
    })),
  };
});

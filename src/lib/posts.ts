import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/api";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { validateForPlatform } from "@/lib/platforms/validate";
import { dispatchPost } from "@/lib/publisher";

export const postInputSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  baseText: z.string().max(25_000),
  mode: z.enum(["ORIGINAL", "AI_OPTIMIZED"]).default("ORIGINAL"),
  mediaIds: z.array(z.string()).max(20).default([]),
  targets: z
    .array(
      z.object({
        socialAccountId: z.string(),
        text: z.string().max(25_000),
        options: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(50),
  action: z.enum(["draft", "publish", "schedule"]),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).default("NONE"),
  recurrenceEndsAt: z.string().datetime({ offset: true }).optional().nullable(),
  source: z.string().optional(),
});

export type PostInput = z.infer<typeof postInputSchema>;

export type TargetIssue = { socialAccountId: string; platform: string; errors: string[] };

/**
 * Validates ownership, account status and per-platform content rules.
 * Drafts are saved even if content doesn't fit a platform yet.
 */
async function check(userId: string, input: PostInput) {
  const strict = input.action !== "draft";
  if (strict && input.targets.length === 0) throw new HttpError(400, "Select at least one account.");
  if (input.action === "schedule") {
    if (!input.scheduledAt) throw new HttpError(400, "Pick a date and time to schedule.");
    if (new Date(input.scheduledAt).getTime() < Date.now() - 60_000) throw new HttpError(400, "That time is in the past.");
  }

  const accountIds = [...new Set(input.targets.map((t) => t.socialAccountId))];
  if (accountIds.length !== input.targets.length) throw new HttpError(400, "An account is selected twice.");
  const accounts = await db.socialAccount.findMany({ where: { id: { in: accountIds }, userId } });
  if (accounts.length !== accountIds.length) throw new HttpError(400, "Unknown account selected.");

  const media = input.mediaIds.length
    ? await db.mediaAsset.findMany({ where: { id: { in: input.mediaIds }, userId } })
    : [];
  if (media.length !== input.mediaIds.length) throw new HttpError(400, "Unknown media attached.");
  if (strict && media.some((m) => !m.uploaded)) throw new HttpError(400, "A file hasn't finished uploading.");
  const ordered = input.mediaIds.map((id) => media.find((m) => m.id === id)!);

  const issues: TargetIssue[] = [];
  if (strict) {
    for (const t of input.targets) {
      const a = accounts.find((x) => x.id === t.socialAccountId)!;
      const errors: string[] = [];
      if (a.status !== "ACTIVE") errors.push(`@${a.username} needs to be reconnected.`);
      if (PLATFORMS[a.platform].status !== "available") errors.push(`${PLATFORMS[a.platform].name} isn't supported yet.`);
      const v = validateForPlatform(a.platform, t.text, ordered, {
        options: t.options,
        accountSettings: a.settings as Record<string, unknown>,
      });
      errors.push(...v.errors);
      if (errors.length) issues.push({ socialAccountId: a.id, platform: a.platform, errors });
    }
  }
  return { issues, ordered };
}

function postData(input: PostInput) {
  const status = input.action === "draft" ? "DRAFT" : input.action === "schedule" ? "SCHEDULED" : "QUEUED";
  return {
    title: input.title ?? null,
    baseText: input.baseText,
    mode: input.mode,
    status,
    // Publish-now posts record "now" so recurrence has an anchor time.
    scheduledAt: input.action === "publish" ? new Date() : input.scheduledAt ? new Date(input.scheduledAt) : null,
    recurrence: input.recurrence,
    recurrenceEndsAt: input.recurrenceEndsAt ? new Date(input.recurrenceEndsAt) : null,
  } as const;
}

export class ValidationFailed extends HttpError {
  constructor(public issues: TargetIssue[]) {
    super(422, "Some platforms can't accept this content yet.");
  }
}

export async function createPost(userId: string, input: PostInput) {
  const { issues } = await check(userId, input);
  if (issues.length) throw new ValidationFailed(issues);

  const post = await db.post.create({
    data: {
      userId,
      ...postData(input),
      source: input.source ?? "composer",
      media: { create: input.mediaIds.map((mediaId, position) => ({ mediaId, position })) },
      targets: {
        create: input.targets.map((t) => ({
          socialAccountId: t.socialAccountId,
          text: t.text,
          options: t.options as Prisma.InputJsonValue,
        })),
      },
    },
  });
  if (input.action === "publish") await dispatchPost(post.id);
  return post;
}

/** Only drafts and scheduled posts can be edited; nothing has been sent yet. */
export async function updatePost(userId: string, postId: string, input: PostInput) {
  const existing = await db.post.findFirst({ where: { id: postId, userId } });
  if (!existing) throw new HttpError(404, "Post not found");
  if (!["DRAFT", "SCHEDULED"].includes(existing.status)) {
    throw new HttpError(409, "This post has already been sent and can't be edited.");
  }
  const { issues } = await check(userId, input);
  if (issues.length) throw new ValidationFailed(issues);

  // Claim it so the scheduler can't dispatch mid-edit.
  const claimed = await db.post.updateMany({
    where: { id: postId, status: { in: ["DRAFT", "SCHEDULED"] } },
    data: { status: "DRAFT" },
  });
  if (!claimed.count) throw new HttpError(409, "This post just started publishing.");

  await db.$transaction([
    db.postTarget.deleteMany({ where: { postId } }),
    db.postMedia.deleteMany({ where: { postId } }),
    db.post.update({
      where: { id: postId },
      data: {
        ...postData(input),
        media: { create: input.mediaIds.map((mediaId, position) => ({ mediaId, position })) },
        targets: {
          create: input.targets.map((t) => ({
            socialAccountId: t.socialAccountId,
            text: t.text,
            options: t.options as Prisma.InputJsonValue,
          })),
        },
      },
    }),
  ]);
  if (input.action === "publish") await dispatchPost(postId);
  return db.post.findUniqueOrThrow({ where: { id: postId } });
}

export const postInclude = {
  media: { include: { media: true }, orderBy: { position: "asc" } },
  targets: {
    include: {
      socialAccount: { select: { id: true, platform: true, username: true, displayName: true, avatarUrl: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.PostInclude;

export type PostWithRelations = Prisma.PostGetPayload<{ include: typeof postInclude }>;

export function serializePost(p: PostWithRelations) {
  return {
    id: p.id,
    title: p.title,
    baseText: p.baseText,
    mode: p.mode,
    status: p.status,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    recurrence: p.recurrence,
    recurrenceEndsAt: p.recurrenceEndsAt?.toISOString() ?? null,
    source: p.source,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    media: p.media.map(({ media: m }) => ({
      id: m.id,
      kind: m.kind,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      width: m.width,
      height: m.height,
      durationSec: m.durationSec,
      originalName: m.originalName,
    })),
    targets: p.targets.map((t) => ({
      id: t.id,
      socialAccountId: t.socialAccountId,
      account: t.socialAccount,
      text: t.text,
      options: t.options as Record<string, unknown>,
      status: t.status,
      externalUrl: t.externalUrl,
      attempts: t.attempts,
      lastError: t.lastError,
      lastErrorCode: t.lastErrorCode,
      publishedAt: t.publishedAt?.toISOString() ?? null,
    })),
  };
}

export type SerializedPost = ReturnType<typeof serializePost>;

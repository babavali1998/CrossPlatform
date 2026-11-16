import type { PostStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api";
import { createPost, postInclude, postInputSchema, serializePost } from "@/lib/posts";

const GROUPS: Record<string, PostStatus[]> = {
  drafts: ["DRAFT"],
  scheduled: ["SCHEDULED"],
  published: ["PUBLISHED", "PARTIAL", "FAILED", "PUBLISHING", "QUEUED"],
  all: ["DRAFT", "SCHEDULED", "QUEUED", "PUBLISHING", "PUBLISHED", "PARTIAL", "FAILED", "CANCELED"],
};

export const GET = withUser(async (userId, req) => {
  const url = new URL(req.url);
  const group = url.searchParams.get("group") || "all";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const posts = await db.post.findMany({
    where: {
      userId,
      status: { in: GROUPS[group] ?? GROUPS.all },
      ...(from || to ? { scheduledAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } } : {}),
    },
    include: postInclude,
    orderBy: group === "scheduled" ? { scheduledAt: "asc" } : { updatedAt: "desc" },
    take: 200,
  });
  return { posts: posts.map(serializePost) };
});

export const POST = withUser(async (userId, req) => {
  const input = postInputSchema.parse(await req.json());
  const post = await createPost(userId, input);
  const full = await db.post.findUniqueOrThrow({ where: { id: post.id }, include: postInclude });
  return { post: serializePost(full) };
});

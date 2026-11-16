import type { PostStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { postInclude, serializePost } from "@/lib/posts";

export async function listPosts(userId: string, statuses: PostStatus[], order: "scheduledAt" | "updatedAt" | "publishedAt") {
  const posts = await db.post.findMany({
    where: { userId, status: { in: statuses } },
    include: postInclude,
    orderBy: order === "scheduledAt" ? { scheduledAt: "asc" } : { [order]: "desc" },
    take: 300,
  });
  return posts.map(serializePost);
}

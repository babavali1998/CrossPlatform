import { db } from "@/lib/db";
import { HttpError, withUser } from "@/lib/api";
import { postInclude, postInputSchema, serializePost, updatePost } from "@/lib/posts";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withUser<Ctx>(async (userId, _req, { params }) => {
  const { id } = await params;
  const post = await db.post.findFirst({ where: { id, userId }, include: postInclude });
  if (!post) throw new HttpError(404, "Post not found");
  const logs = await db.publishLog.findMany({
    where: { target: { postId: id } },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  return { post: serializePost(post), logs };
});

export const PUT = withUser<Ctx>(async (userId, req, { params }) => {
  const { id } = await params;
  const input = postInputSchema.parse(await req.json());
  await updatePost(userId, id, input);
  const full = await db.post.findUniqueOrThrow({ where: { id }, include: postInclude });
  return { post: serializePost(full) };
});

export const DELETE = withUser<Ctx>(async (userId, _req, { params }) => {
  const { id } = await params;
  const deleted = await db.post.deleteMany({ where: { id, userId, status: { in: ["DRAFT", "SCHEDULED", "CANCELED"] } } });
  if (!deleted.count) {
    throw new HttpError(409, "Only drafts and scheduled posts can be deleted here. Delete published posts on the platform itself.");
  }
  return { ok: true };
});

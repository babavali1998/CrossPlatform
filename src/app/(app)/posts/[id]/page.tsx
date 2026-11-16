import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { postInclude, serializePost } from "@/lib/posts";
import { PostResults } from "./post-results";

export const metadata = { title: "Post" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const post = await db.post.findFirst({ where: { id, userId: user.id }, include: postInclude });
  if (!post) notFound();
  return <PostResults initial={serializePost(post)} />;
}

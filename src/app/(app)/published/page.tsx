import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listPosts } from "@/lib/post-queries";
import { PostList } from "@/components/post-list";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Published" };

export default async function PublishedPage() {
  const user = await requireUser();
  const posts = await listPosts(user.id, ["PUBLISHED", "PARTIAL", "FAILED", "PUBLISHING", "QUEUED"], "updatedAt");
  return (
    <>
      <PageHeader title="Published" description="Post history with the result on every platform. Open a post to see links or retry failures." />
      {posts.length ? (
        <PostList posts={posts} timeField="publishedAt" />
      ) : (
        <EmptyState
          title="Nothing published yet"
          action={
            <Button asChild variant="primary">
              <Link href="/compose">Create post</Link>
            </Button>
          }
        />
      )}
    </>
  );
}

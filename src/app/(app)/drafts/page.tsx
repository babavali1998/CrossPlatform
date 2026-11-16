import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listPosts } from "@/lib/post-queries";
import { PostList } from "@/components/post-list";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Drafts" };

export default async function DraftsPage() {
  const user = await requireUser();
  const posts = await listPosts(user.id, ["DRAFT"], "updatedAt");
  return (
    <>
      <PageHeader title="Drafts" description="Saved posts that haven't been scheduled or published." />
      {posts.length ? (
        <PostList posts={posts} timeField="updatedAt" />
      ) : (
        <EmptyState
          title="No drafts"
          body="Use Save draft in the composer to keep a post for later."
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

import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listPosts } from "@/lib/post-queries";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ScheduledView } from "./scheduled-view";

export const metadata = { title: "Scheduled" };

export default async function ScheduledPage() {
  const user = await requireUser();
  const posts = await listPosts(user.id, ["SCHEDULED"], "scheduledAt");
  return (
    <>
      <PageHeader
        title="Scheduled"
        description="Posts waiting to go out. The worker publishes each one within a minute of its time."
        actions={
          <Button asChild variant="secondary">
            <Link href="/bulk">Bulk upload</Link>
          </Button>
        }
      />
      {posts.length ? (
        <ScheduledView posts={posts} />
      ) : (
        <EmptyState
          title="Nothing scheduled"
          body="Choose Schedule in the composer, or import a CSV of posts."
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

import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/ui/misc";
import { Composer, DeleteDraftButton, type ComposerAccount, type ComposerInitial } from "@/components/composer/composer";

export const metadata = { title: "Create post" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ post?: string }> }) {
  const user = await requireUser();
  const { post: postId } = await searchParams;

  const accounts = await db.socialAccount.findMany({
    where: { userId: user.id, status: { not: "REVOKED" } },
    orderBy: { createdAt: "asc" },
  });

  let initial: ComposerInitial | undefined;
  if (postId) {
    const post = await db.post.findFirst({
      where: { id: postId, userId: user.id, status: { in: ["DRAFT", "SCHEDULED"] } },
      include: { media: { include: { media: true }, orderBy: { position: "asc" } }, targets: true },
    });
    if (post) {
      initial = {
        postId: post.id,
        status: post.status,
        baseText: post.baseText,
        mode: post.mode,
        media: post.media.map(({ media: m }) => ({
          id: m.id,
          name: m.originalName ?? "file",
          kind: m.kind,
          mimeType: m.mimeType,
          sizeBytes: m.sizeBytes,
          width: m.width ?? undefined,
          height: m.height ?? undefined,
          durationSec: m.durationSec ?? undefined,
        })),
        targets: post.targets.map((t) => ({
          socialAccountId: t.socialAccountId,
          text: t.text,
          options: (t.options as Record<string, unknown>) ?? {},
        })),
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        recurrence: post.recurrence,
        recurrenceEndsAt: post.recurrenceEndsAt?.toISOString() ?? null,
      };
    }
  }

  const list: ComposerAccount[] = accounts.map((a) => ({
    id: a.id,
    platform: a.platform,
    username: a.username,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    status: a.status,
    settings: (a.settings as Record<string, unknown>) ?? {},
  }));

  return (
    <>
      <PageHeader
        title={initial ? (initial.status === "SCHEDULED" ? "Edit scheduled post" : "Edit draft") : "Create post"}
        description="Write it once, pick where it goes, and check each version before it's sent."
        actions={initial ? <DeleteDraftButton postId={initial.postId} /> : undefined}
      />
      <Composer key={initial?.postId ?? "new"} accounts={list} aiEnabled={!!process.env.OPENAI_API_KEY} initial={initial} />
    </>
  );
}

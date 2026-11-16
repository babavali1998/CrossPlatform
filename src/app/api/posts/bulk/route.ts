import { z } from "zod";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api";
import { importMediaFromUrl, parseBulkCsv } from "@/lib/bulk";
import { createPost, ValidationFailed } from "@/lib/posts";
import { PLATFORMS } from "@/lib/platforms/catalog";

const schema = z.object({ csv: z.string().min(1).max(500_000), preview: z.boolean().default(true) });

/** Preview (validate only) or import a CSV of posts as drafts / scheduled posts. */
export const POST = withUser(async (userId, req) => {
  const { csv, preview } = schema.parse(await req.json());
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const accounts = await db.socialAccount.findMany({ where: { userId, status: { not: "REVOKED" } } });
  const rows = parseBulkCsv(csv, accounts, user.timezone);

  if (preview) {
    return {
      rows: rows.map((r) => ({
        ...r,
        accounts: r.accountIds.map((id) => {
          const a = accounts.find((x) => x.id === id)!;
          return `${PLATFORMS[a.platform].name} @${a.username}`;
        }),
      })),
    };
  }

  const results: Array<{ row: number; ok: boolean; postId?: string; error?: string }> = [];
  for (const r of rows) {
    if (r.errors.length) {
      results.push({ row: r.row, ok: false, error: r.errors.join("; ") });
      continue;
    }
    try {
      const mediaIds: string[] = [];
      if (r.mediaUrl) mediaIds.push((await importMediaFromUrl(userId, r.mediaUrl)).id);
      const post = await createPost(userId, {
        baseText: r.text,
        mode: "ORIGINAL",
        mediaIds,
        targets: r.accountIds.map((socialAccountId) => {
          const a = accounts.find((x) => x.id === socialAccountId)!;
          return { socialAccountId, text: r.text, options: a.platform === "INSTAGRAM" ? { igFormat: r.igFormat } : {} };
        }),
        action: r.scheduledAt ? "schedule" : "draft",
        scheduledAt: r.scheduledAt,
        recurrence: "NONE",
        source: "bulk",
      });
      results.push({ row: r.row, ok: true, postId: post.id });
    } catch (err) {
      const msg =
        err instanceof ValidationFailed
          ? err.issues.map((i) => `${PLATFORMS[i.platform as keyof typeof PLATFORMS].name}: ${i.errors.join(", ")}`).join("; ")
          : (err as Error).message;
      results.push({ row: r.row, ok: false, error: msg });
    }
  }
  return { results };
});

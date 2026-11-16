import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, withUser } from "@/lib/api";
import { dispatchPost, retryFailed } from "@/lib/publisher";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish-now") }),
  z.object({ action: z.literal("unschedule") }),
  z.object({ action: z.literal("retry"), force: z.boolean().optional(), targetIds: z.array(z.string()).optional() }),
]);

export const POST = withUser<Ctx>(async (userId, req, { params }) => {
  const { id } = await params;
  const body = schema.parse(await req.json());
  const post = await db.post.findFirst({ where: { id, userId } });
  if (!post) throw new HttpError(404, "Post not found");

  switch (body.action) {
    case "publish-now": {
      // Atomic: only one click (or the scheduler) wins.
      const claimed = await db.post.updateMany({
        where: { id, status: { in: ["DRAFT", "SCHEDULED"] } },
        data: { status: "QUEUED", scheduledAt: new Date() },
      });
      if (!claimed.count) throw new HttpError(409, "This post is already publishing or published.");
      const queued = await dispatchPost(id);
      return { queued };
    }
    case "unschedule": {
      const r = await db.post.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "DRAFT" } });
      if (!r.count) throw new HttpError(409, "Only scheduled posts can be moved back to drafts.");
      return { ok: true };
    }
    case "retry": {
      if (!["PARTIAL", "FAILED"].includes(post.status)) throw new HttpError(409, "Nothing to retry on this post.");
      return retryFailed(id, { force: body.force, targetIds: body.targetIds });
    }
  }
});

import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, withUser } from "@/lib/api";
import { getAccountContext, saveConnection, serializeAccount } from "@/lib/accounts";
import { getAdapter } from "@/lib/platforms/registry";
import { PlatformError } from "@/lib/platforms/errors";
import { decrypt } from "@/lib/crypto";

type Ctx = { params: Promise<{ id: string }> };

async function own(userId: string, id: string) {
  const a = await db.socialAccount.findFirst({ where: { id, userId } });
  if (!a) throw new HttpError(404, "Account not found");
  return a;
}

const patchSchema = z.object({
  settings: z.object({ maxChars: z.number().int().min(1).max(25_000).nullable().optional() }).optional(),
});

export const PATCH = withUser<Ctx>(async (userId, req, { params }) => {
  const { id } = await params;
  const a = await own(userId, id);
  const body = patchSchema.parse(await req.json());
  const settings = { ...((a.settings as object) || {}) } as Record<string, unknown>;
  if (body.settings && "maxChars" in body.settings) {
    if (body.settings.maxChars == null) delete settings.maxChars;
    else settings.maxChars = body.settings.maxChars;
  }
  const updated = await db.socialAccount.update({ where: { id }, data: { settings: settings as object } });
  return { account: serializeAccount(updated) };
});

/** Re-checks the connection by refreshing the token and profile. */
export const POST = withUser<Ctx>(async (userId, _req, { params }) => {
  const { id } = await params;
  const a = await own(userId, id);
  try {
    const ctx = await getAccountContext(a);
    const adapter = getAdapter(a.platform);
    const profile = await adapter.fetchProfile(ctx.accessToken);
    const fresh = await db.socialAccount.findUniqueOrThrow({ where: { id } });
    const updated = await saveConnection(
      userId,
      a.platform,
      {
        accessToken: ctx.accessToken,
        refreshToken: fresh.refreshTokenEnc ? decrypt(fresh.refreshTokenEnc) : null,
        expiresAt: fresh.tokenExpiresAt,
        refreshExpiresAt: fresh.refreshExpiresAt,
        scopes: fresh.scopes,
      },
      profile,
    );
    return { account: serializeAccount(updated) };
  } catch (err) {
    if (err instanceof PlatformError && (err.kind === "auth" || err.kind === "permission")) {
      const updated = await db.socialAccount.update({
        where: { id },
        data: { status: "NEEDS_RECONNECT", statusMessage: err.message },
      });
      return { account: serializeAccount(updated) };
    }
    throw new HttpError(502, (err as Error).message);
  }
});

/** Disconnects: deletes stored tokens. Published post history is kept. */
export const DELETE = withUser<Ctx>(async (userId, _req, { params }) => {
  const { id } = await params;
  await own(userId, id);
  const pending = await db.postTarget.count({
    where: { socialAccountId: id, status: { in: ["QUEUED", "PUBLISHING"] } },
  });
  if (pending) throw new HttpError(409, "This account has posts publishing right now. Try again in a minute.");
  // Soft delete: wipe the tokens but keep the row so post history still
  // shows which account a post went to. Reconnecting reactivates it.
  await db.socialAccount.update({
    where: { id },
    data: { status: "REVOKED", accessTokenEnc: "", refreshTokenEnc: null, statusMessage: "Disconnected" },
  });
  await db.postTarget.updateMany({
    where: { socialAccountId: id, status: { in: ["PENDING"] } },
    data: { status: "CANCELED", lastError: "Account disconnected" },
  });
  return { ok: true };
});

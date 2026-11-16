import type { SocialAccount } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getAdapter } from "@/lib/platforms/registry";
import { PlatformError } from "@/lib/platforms/errors";
import type { AccountContext, OAuthTokens, Profile } from "@/lib/platforms/types";

/** Refresh when a token has less than this long left. */
const REFRESH_WINDOW_MS = 7 * 24 * 3600_000; // Meta 60-day tokens
const SHORT_REFRESH_WINDOW_MS = 10 * 60_000; // X 2-hour tokens

export async function saveConnection(userId: string, account: SocialAccount["platform"], tokens: OAuthTokens, profile: Profile) {
  const data = {
    username: profile.username,
    displayName: profile.displayName ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    accessTokenEnc: encrypt(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    tokenExpiresAt: tokens.expiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null,
    scopes: tokens.scopes,
    status: "ACTIVE" as const,
    statusMessage: null,
    lastSyncedAt: new Date(),
  };
  const saved = await db.socialAccount.upsert({
    where: { userId_platform_externalId: { userId, platform: account, externalId: profile.externalId } },
    create: { userId, platform: account, externalId: profile.externalId, ...data },
    update: data,
  });
  if (typeof profile.followers === "number") {
    await db.followerSnapshot.create({ data: { socialAccountId: saved.id, followers: profile.followers } });
  }
  return saved;
}

export async function markNeedsReconnect(accountId: string, message: string) {
  await db.socialAccount.update({
    where: { id: accountId },
    data: { status: "NEEDS_RECONNECT", statusMessage: message.slice(0, 500) },
  });
}

/**
 * Returns a usable access token, refreshing it first when it is close to
 * expiry. Throws an "auth" PlatformError (and flags the account) when the
 * user needs to reconnect.
 */
export async function getAccountContext(account: SocialAccount): Promise<AccountContext> {
  if (account.status !== "ACTIVE") {
    throw new PlatformError(`${account.platform} account @${account.username} needs to be reconnected`, {
      kind: "auth",
      code: "NEEDS_RECONNECT",
    });
  }
  const adapter = getAdapter(account.platform);
  let accessToken = decrypt(account.accessTokenEnc);
  const refreshToken = account.refreshTokenEnc ? decrypt(account.refreshTokenEnc) : null;
  const exp = account.tokenExpiresAt?.getTime();
  const window = refreshToken ? SHORT_REFRESH_WINDOW_MS : REFRESH_WINDOW_MS;

  if (exp && exp - Date.now() < window) {
    if (exp < Date.now() && !adapter.refresh) {
      await markNeedsReconnect(account.id, "Access token expired");
      throw new PlatformError("Access token expired; reconnect the account", { kind: "auth", code: "TOKEN_EXPIRED" });
    }
    if (adapter.refresh) {
      try {
        const t = await adapter.refresh({ accessToken, refreshToken });
        accessToken = t.accessToken;
        await db.socialAccount.update({
          where: { id: account.id },
          data: {
            accessTokenEnc: encrypt(t.accessToken),
            // X rotates refresh tokens on every use.
            ...(t.refreshToken ? { refreshTokenEnc: encrypt(t.refreshToken) } : {}),
            tokenExpiresAt: t.expiresAt ?? null,
            ...(t.refreshExpiresAt ? { refreshExpiresAt: t.refreshExpiresAt } : {}),
          },
        });
      } catch (err) {
        // Only give up if the old token is actually dead.
        if (exp < Date.now() || (err instanceof PlatformError && err.kind === "auth")) {
          await markNeedsReconnect(account.id, `Token refresh failed: ${(err as Error).message}`);
          throw new PlatformError("Token refresh failed; reconnect the account", { kind: "auth", code: "REFRESH_FAILED" });
        }
      }
    }
  }

  return {
    id: account.id,
    externalId: account.externalId,
    username: account.username,
    accessToken,
    settings: (account.settings as Record<string, unknown>) || {},
  };
}

/** Public, token-free shape for the UI. */
export function serializeAccount(a: SocialAccount) {
  return {
    id: a.id,
    platform: a.platform,
    username: a.username,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    status: a.status,
    statusMessage: a.statusMessage,
    scopes: a.scopes,
    tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
    settings: (a.settings as Record<string, unknown>) || {},
    createdAt: a.createdAt.toISOString(),
  };
}

export type SerializedAccount = ReturnType<typeof serializeAccount>;

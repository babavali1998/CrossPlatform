import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { randomToken, pkceChallenge } from "@/lib/crypto";
import { getAdapter, isConfigured, platformFromSlug } from "@/lib/platforms/registry";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { appUrl } from "@/lib/env";

/** Starts the official OAuth flow for a platform. */
export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: slug } = await params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(appUrl("/login"));

  const platform = platformFromSlug(slug);
  if (!platform || PLATFORMS[platform].status !== "available") {
    return NextResponse.redirect(appUrl(`/accounts?error=${encodeURIComponent("That platform isn't supported yet.")}`));
  }
  if (!isConfigured(platform)) {
    const keys = PLATFORMS[platform].envKeys.join(", ");
    return NextResponse.redirect(
      appUrl(`/accounts?error=${encodeURIComponent(`${PLATFORMS[platform].name} isn't configured on the server. Set ${keys}.`)}`),
    );
  }

  const adapter = getAdapter(platform);
  const state = randomToken(24);
  const codeVerifier = adapter.usesPkce ? randomToken(48) : undefined;

  await db.oAuthState.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  await db.oAuthState.create({
    data: { id: state, userId, platform, codeVerifier, expiresAt: new Date(Date.now() + 15 * 60_000) },
  });

  const url = adapter.buildAuthUrl({
    state,
    redirectUri: appUrl(`/api/connect/${slug.toLowerCase()}/callback`),
    codeChallenge: codeVerifier ? pkceChallenge(codeVerifier) : undefined,
  });
  return NextResponse.redirect(url);
}

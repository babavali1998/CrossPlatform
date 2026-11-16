import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { getAdapter, platformFromSlug } from "@/lib/platforms/registry";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { saveConnection } from "@/lib/accounts";
import { appUrl } from "@/lib/env";

function back(params: Record<string, string>) {
  return NextResponse.redirect(appUrl(`/accounts?${new URLSearchParams(params)}`));
}

/** OAuth redirect target: validates state, exchanges the code, stores encrypted tokens. */
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: slug } = await params;
  const url = new URL(req.url);
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(appUrl("/login"));

  const platform = platformFromSlug(slug);
  if (!platform) return back({ error: "Unknown platform" });
  const name = PLATFORMS[platform].name;

  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) return back({ error: `${name}: ${providerError}` });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back({ error: `${name}: missing code or state` });

  // Single-use state: delete it whether or not the rest succeeds.
  const saved = await db.oAuthState.findUnique({ where: { id: state } });
  if (saved) await db.oAuthState.delete({ where: { id: state } });
  if (!saved || saved.userId !== userId || saved.platform !== platform || saved.expiresAt < new Date()) {
    return back({ error: `${name}: the sign-in link expired or didn't match. Please try again.` });
  }

  try {
    const adapter = getAdapter(platform);
    const tokens = await adapter.exchangeCode({
      code,
      redirectUri: appUrl(`/api/connect/${slug.toLowerCase()}/callback`),
      codeVerifier: saved.codeVerifier ?? undefined,
    });
    const profile = await adapter.fetchProfile(tokens.accessToken, { userId: tokens.userId });
    const account = await saveConnection(userId, platform, tokens, profile);
    return back({ connected: account.id });
  } catch (err) {
    console.error(`[connect:${platform}]`, err);
    return back({ error: `${name}: ${(err as Error).message}` });
  }
}

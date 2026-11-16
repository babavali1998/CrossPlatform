import { PLATFORMS } from "../catalog";
import { PlatformError } from "../errors";
import { expiresAt, form, platformFetch, platformJson, sleep } from "../http";
import type { PlatformAdapter, PublishContext, PublishMedia, PublishResult } from "../types";
import { requireEnv, optionalEnv } from "@/lib/env";

/**
 * X API v2 with OAuth 2.0 (PKCE, user context).
 * Media: POST /2/media/upload/initialize -> /{id}/append -> /{id}/finalize (+ STATUS polling)
 * Post:  POST /2/tweets { text, media: { media_ids } }
 */
const API = "https://api.x.com";
const P = "X";
export const SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];
const CHUNK = 4 * 1024 * 1024;

function tokenHeaders(): Record<string, string> {
  const id = requireEnv("X_CLIENT_ID");
  const secret = optionalEnv("X_CLIENT_SECRET");
  const h: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (secret) h.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  return h;
}

type TokenRes = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

function toTokens(t: TokenRes) {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? null,
    expiresAt: expiresAt(t.expires_in),
    scopes: t.scope ? t.scope.split(" ") : SCOPES,
  };
}

export const x: PlatformAdapter = {
  ...PLATFORMS.X,
  usesPkce: true,

  buildAuthUrl({ state, redirectUri, codeChallenge }) {
    const u = new URL("https://x.com/i/oauth2/authorize");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", requireEnv("X_CLIENT_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("scope", SCOPES.join(" "));
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", codeChallenge!);
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  },

  async exchangeCode({ code, redirectUri, codeVerifier }) {
    const t = await platformJson<TokenRes>(`${API}/2/oauth2/token`, {
      platform: P,
      method: "POST",
      headers: tokenHeaders(),
      body: form({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: requireEnv("X_CLIENT_ID"),
      }),
    });
    return toTokens(t);
  },

  async refresh({ refreshToken }) {
    if (!refreshToken) {
      throw new PlatformError("X: no refresh token stored; reconnect the account", { kind: "auth", code: "NO_REFRESH" });
    }
    const t = await platformJson<TokenRes>(`${API}/2/oauth2/token`, {
      platform: P,
      method: "POST",
      headers: tokenHeaders(),
      body: form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: requireEnv("X_CLIENT_ID") }),
    });
    return toTokens(t);
  },

  async fetchProfile(token) {
    const res = await platformJson<{
      data: { id: string; username: string; name: string; profile_image_url?: string; public_metrics?: { followers_count: number } };
    }>(`${API}/2/users/me?user.fields=profile_image_url,public_metrics`, {
      platform: P,
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      externalId: res.data.id,
      username: res.data.username,
      displayName: res.data.name,
      avatarUrl: res.data.profile_image_url?.replace("_normal", "_200x200") ?? null,
      followers: res.data.public_metrics?.followers_count ?? null,
    };
  },

  /**
   * If a previous attempt timed out after sending the post, look at the
   * account's recent posts for the same text before posting again.
   */
  async reconcile(ctx) {
    if (!ctx.state.inFlightAt) return null;
    const since = new Date(String(ctx.state.inFlightAt));
    since.setMinutes(since.getMinutes() - 2);
    const u = new URL(`${API}/2/users/${ctx.account.externalId}/tweets`);
    u.searchParams.set("max_results", "10");
    u.searchParams.set("start_time", since.toISOString());
    u.searchParams.set("tweet.fields", "text,created_at");
    try {
      const res = await platformJson<{ data?: Array<{ id: string; text: string }> }>(u.toString(), {
        platform: P,
        headers: { Authorization: `Bearer ${ctx.account.accessToken}` },
      });
      const norm = (s: string) => s.replace(/https:\/\/t\.co\/\S+/g, "").replace(/\s+/g, " ").trim();
      const match = res.data?.find((t) => norm(t.text) === norm(ctx.text));
      if (match) {
        await ctx.log("Found the post from the interrupted attempt; not posting again.", { id: match.id });
        return { externalId: match.id, url: this.profileUrl(ctx.account.username).replace(/\/$/, "") + `/status/${match.id}` };
      }
      return null;
    } catch {
      return "unknown";
    }
  },

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const token = ctx.account.accessToken;
    const uploaded: Record<string, string> = (ctx.state.mediaIds as Record<string, string>) || {};
    const mediaIds: string[] = [];
    for (const m of ctx.media) {
      // X media ids expire after ~24h; re-upload if the stored one is stale.
      const prev = uploaded[m.id];
      const prevAt = Number((ctx.state.mediaUploadedAt as Record<string, number> | undefined)?.[m.id] || 0);
      if (prev && Date.now() - prevAt < 20 * 3600_000) {
        mediaIds.push(prev);
        continue;
      }
      const id = await uploadMedia(token, m, await ctx.mediaBytes(m), ctx.log);
      uploaded[m.id] = id;
      mediaIds.push(id);
      await ctx.saveState({
        mediaIds: uploaded,
        mediaUploadedAt: { ...((ctx.state.mediaUploadedAt as object) || {}), [m.id]: Date.now() },
      });
    }

    const body: Record<string, unknown> = { text: ctx.text };
    if (mediaIds.length) body.media = { media_ids: mediaIds };

    const res = await ctx.criticalWrite(() =>
      platformJson<{ data: { id: string } }>(`${API}/2/tweets`, {
        platform: P,
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    const id = res.data.id;
    return { externalId: id, url: `https://x.com/${ctx.account.username}/status/${id}` };
  },

  async fetchPostMetrics(account, externalId) {
    if (process.env.X_ENABLE_METRICS !== "true") return null;
    const res = await platformJson<{
      data: { public_metrics: { impression_count?: number; like_count: number; reply_count: number; retweet_count: number; quote_count: number; bookmark_count?: number } };
    }>(`${API}/2/tweets/${externalId}?tweet.fields=public_metrics`, {
      platform: P,
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    const m = res.data.public_metrics;
    return {
      views: m.impression_count ?? null,
      likes: m.like_count,
      comments: m.reply_count,
      shares: m.retweet_count + m.quote_count,
      saves: m.bookmark_count ?? null,
      raw: res,
    };
  },

  async fetchFollowers(account) {
    if (process.env.X_ENABLE_METRICS !== "true") return null;
    const p = await this.fetchProfile(account.accessToken);
    return p.followers ?? null;
  },

  profileUrl(username) {
    return `https://x.com/${username}`;
  },
};

function category(m: PublishMedia): string {
  if (m.kind === "VIDEO") return "tweet_video";
  if (m.mimeType === "image/gif") return "tweet_gif";
  return "tweet_image";
}

async function uploadMedia(
  token: string,
  m: PublishMedia,
  bytes: Buffer,
  log: (msg: string, d?: unknown) => Promise<void>,
): Promise<string> {
  const auth = { Authorization: `Bearer ${token}` };
  const init = await platformJson<{ data: { id: string } }>(`${API}/2/media/upload/initialize`, {
    platform: P,
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: m.mimeType, total_bytes: bytes.length, media_category: category(m) }),
  });
  const id = init.data.id;

  for (let i = 0, seg = 0; i < bytes.length; i += CHUNK, seg++) {
    const fd = new FormData();
    fd.set("segment_index", String(seg));
    fd.set("media", new Blob([new Uint8Array(bytes.subarray(i, i + CHUNK))]), "chunk");
    await platformFetch(`${API}/2/media/upload/${id}/append`, {
      platform: P,
      method: "POST",
      headers: auth,
      body: fd,
      timeoutMs: 120_000,
    });
  }

  const fin = await platformJson<{ data: { id: string; processing_info?: { state: string; check_after_secs?: number } } }>(
    `${API}/2/media/upload/${id}/finalize`,
    { platform: P, method: "POST", headers: auth },
  );

  let info = fin.data.processing_info;
  const deadline = Date.now() + 10 * 60_000;
  while (info && info.state !== "succeeded") {
    if (info.state === "failed") {
      throw new PlatformError("X: media processing failed", { kind: "validation", code: "MEDIA_PROCESSING_FAILED", details: info });
    }
    if (Date.now() > deadline) {
      throw new PlatformError("X: media still processing; will retry", { kind: "transient", code: "PROCESSING_TIMEOUT" });
    }
    await log("Waiting for X to process media", info);
    await sleep(Math.max(1, info.check_after_secs ?? 5) * 1000);
    const st = await platformJson<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>(
      `${API}/2/media/upload?command=STATUS&media_id=${id}`,
      { platform: P, headers: auth },
    );
    info = st.data.processing_info;
  }
  return id;
}

import { PLATFORMS } from "../catalog";
import { expiresAt, form, platformJson } from "../http";
import type { PlatformAdapter, PublishContext, PublishMedia, PublishResult } from "../types";
import { metaGet, metaPost, waitForContainer } from "./meta-common";
import { requireEnv } from "@/lib/env";

/**
 * Instagram API with Instagram Login (no Facebook Page needed).
 * Docs: developers.facebook.com/documentation/instagram-platform/content-publishing
 * Flow: POST /{ig-id}/media (container) -> poll status_code -> POST /{ig-id}/media_publish
 */
const GRAPH = "https://graph.instagram.com";
const V = () => process.env.INSTAGRAM_GRAPH_VERSION || "v26.0";
const P = "Instagram";

export const SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
];

type TokenRes = { access_token: string; user_id: string | number; permissions?: string[] | string };

export const instagram: PlatformAdapter = {
  ...PLATFORMS.INSTAGRAM,

  buildAuthUrl({ state, redirectUri }) {
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.searchParams.set("client_id", requireEnv("INSTAGRAM_APP_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", SCOPES.join(","));
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode({ code, redirectUri }) {
    const raw = await platformJson<TokenRes | { data: TokenRes[] }>("https://api.instagram.com/oauth/access_token", {
      platform: P,
      method: "POST",
      body: form({
        client_id: requireEnv("INSTAGRAM_APP_ID"),
        client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: code.replace(/#_$/, ""),
      }),
    });
    const short = "data" in raw ? raw.data[0] : raw;
    const long = await metaGet<{ access_token: string; expires_in: number }>(P, `${GRAPH}/access_token`, short.access_token, {
      grant_type: "ig_exchange_token",
      client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
      access_token: short.access_token,
    });
    const perms = Array.isArray(short.permissions)
      ? short.permissions
      : String(short.permissions || SCOPES.join(",")).split(",");
    return {
      accessToken: long.access_token,
      expiresAt: expiresAt(long.expires_in),
      scopes: perms,
      userId: String(short.user_id),
    };
  },

  async refresh({ accessToken }) {
    const res = await metaGet<{ access_token: string; expires_in: number }>(P, `${GRAPH}/refresh_access_token`, accessToken, {
      grant_type: "ig_refresh_token",
      access_token: accessToken,
    });
    return { accessToken: res.access_token, expiresAt: expiresAt(res.expires_in), scopes: SCOPES };
  },

  async fetchProfile(token) {
    const me = await metaGet<{
      user_id?: string;
      id: string;
      username: string;
      name?: string;
      profile_picture_url?: string;
      followers_count?: number;
      account_type?: string;
    }>(P, `${GRAPH}/${V()}/me`, token, {
      fields: "user_id,username,name,profile_picture_url,followers_count,account_type",
    });
    return {
      externalId: String(me.user_id || me.id),
      username: me.username,
      displayName: me.name ?? null,
      avatarUrl: me.profile_picture_url ?? null,
      followers: me.followers_count ?? null,
    };
  },

  async reconcile(ctx) {
    const containerId = ctx.state.containerId as string | undefined;
    if (!containerId) return null;
    const s = await getStatus(ctx.account.accessToken, containerId);
    if (s.status === "PUBLISHED") {
      await ctx.log("Container already published by a previous attempt; not publishing again.");
      return { externalId: String(ctx.state.publishedId || containerId), url: this.profileUrl(ctx.account.username) };
    }
    return null;
  },

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const { account, media } = ctx;
    const token = account.accessToken;
    const base = `${GRAPH}/${V()}/${account.externalId}`;
    const format = String(ctx.options.igFormat || "FEED");
    const hasVideo = media.some((m) => m.kind === "VIDEO");

    let containerId = ctx.state.containerId as string | undefined;
    if (containerId) {
      const s = await getStatus(token, containerId);
      if (s.status === "EXPIRED" || s.status === "ERROR") containerId = undefined;
    }

    if (!containerId) {
      if (format === "STORY") {
        containerId = (await metaPost<{ id: string }>(P, `${base}/media`, token, {
          media_type: "STORIES",
          ...(await mediaParam(ctx, media[0])),
        })).id;
      } else if (format === "REEL") {
        containerId = (await metaPost<{ id: string }>(P, `${base}/media`, token, {
          media_type: "REELS",
          video_url: await ctx.mediaUrl(media[0]),
          caption: ctx.text || undefined,
          share_to_feed: String(ctx.options.shareToFeed ?? true),
        })).id;
      } else if (media.length === 1) {
        const m = media[0];
        containerId = (await metaPost<{ id: string }>(P, `${base}/media`, token, {
          // Single feed videos are published as Reels by Instagram.
          ...(m.kind === "VIDEO" ? { media_type: "REELS" } : {}),
          ...(await mediaParam(ctx, m)),
          caption: ctx.text || undefined,
        })).id;
      } else {
        const children: string[] = (ctx.state.children as string[]) || [];
        for (let i = children.length; i < media.length; i++) {
          const m = media[i];
          const child = await metaPost<{ id: string }>(P, `${base}/media`, token, {
            ...(m.kind === "VIDEO" ? { media_type: "VIDEO" } : {}),
            ...(await mediaParam(ctx, m)),
            is_carousel_item: "true",
          });
          children.push(child.id);
          await ctx.saveState({ children });
        }
        for (const id of children) {
          await waitForContainer({ platform: P, isVideo: hasVideo, log: ctx.log, getStatus: () => getStatus(token, id) });
        }
        containerId = (await metaPost<{ id: string }>(P, `${base}/media`, token, {
          media_type: "CAROUSEL",
          children: children.join(","),
          caption: ctx.text || undefined,
        })).id;
      }
      await ctx.saveState({ containerId });
      await ctx.log("Created Instagram container", { containerId, format });
    }

    const status = await waitForContainer({
      platform: P,
      isVideo: hasVideo,
      log: ctx.log,
      getStatus: () => getStatus(token, containerId!),
    });
    if (status === "PUBLISHED") return { externalId: containerId, url: this.profileUrl(account.username) };

    const published = await ctx.criticalWrite(() =>
      metaPost<{ id: string }>(P, `${base}/media_publish`, token, { creation_id: containerId }),
    );
    await ctx.saveState({ publishedId: published.id });

    let url: string | null = null;
    try {
      const p = await metaGet<{ permalink?: string }>(P, `${GRAPH}/${V()}/${published.id}`, token, { fields: "permalink" });
      url = p.permalink ?? null;
    } catch {
      url = this.profileUrl(account.username);
    }
    return { externalId: published.id, url };
  },

  async fetchPostMetrics(account, externalId) {
    const res = await metaGet<{ data: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }> }>(
      P,
      `${GRAPH}/${V()}/${externalId}/insights`,
      account.accessToken,
      { metric: "views,reach,likes,comments,shares,saved" },
    );
    const v = (n: string) => {
      const d = res.data.find((x) => x.name === n);
      return d?.total_value?.value ?? d?.values?.[0]?.value ?? null;
    };
    return {
      views: v("views"),
      reach: v("reach"),
      likes: v("likes"),
      comments: v("comments"),
      shares: v("shares"),
      saves: v("saved"),
      raw: res,
    };
  },

  async fetchFollowers(account) {
    const me = await metaGet<{ followers_count?: number }>(P, `${GRAPH}/${V()}/me`, account.accessToken, {
      fields: "followers_count",
    });
    return me.followers_count ?? null;
  },

  profileUrl(username) {
    return `https://www.instagram.com/${username}/`;
  },
};

async function mediaParam(ctx: PublishContext, m: PublishMedia): Promise<Record<string, string>> {
  return m.kind === "VIDEO" ? { video_url: await ctx.mediaUrl(m) } : { image_url: await ctx.jpegUrl(m) };
}

async function getStatus(token: string, id: string) {
  const s = await metaGet<{ status_code: string; status?: string }>(P, `${GRAPH}/${V()}/${id}`, token, {
    fields: "status_code,status",
  });
  return { status: s.status_code, error: s.status };
}

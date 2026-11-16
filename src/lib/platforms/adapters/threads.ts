import { PLATFORMS } from "../catalog";
import { expiresAt, form, platformJson } from "../http";
import type { PlatformAdapter, PublishContext, PublishResult } from "../types";
import { metaGet, metaPost, waitForContainer } from "./meta-common";
import { requireEnv } from "@/lib/env";

/**
 * Threads API (Meta). Docs: developers.facebook.com/documentation/threads
 * Flow: create container(s) -> wait until FINISHED -> threads_publish.
 */
const GRAPH = () => (process.env.THREADS_GRAPH_HOST || "https://graph.threads.com").replace(/\/$/, "");
const AUTH_HOST = () => (process.env.THREADS_AUTH_HOST || "https://threads.com").replace(/\/$/, "");
const V = "v1.0";
const P = "Threads";

export const SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_insights"];

type ContainerStatusRes = { status: string; error_message?: string };

export const threads: PlatformAdapter = {
  ...PLATFORMS.THREADS,

  buildAuthUrl({ state, redirectUri }) {
    const u = new URL(`${AUTH_HOST()}/oauth/authorize`);
    u.searchParams.set("client_id", requireEnv("THREADS_APP_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("scope", SCOPES.join(","));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode({ code, redirectUri }) {
    const short = await platformJson<{ access_token: string; user_id: string | number }>(`${GRAPH()}/oauth/access_token`, {
      platform: P,
      method: "POST",
      body: form({
        client_id: requireEnv("THREADS_APP_ID"),
        client_secret: requireEnv("THREADS_APP_SECRET"),
        code: code.replace(/#_$/, ""),
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    // Swap the 1-hour token for a 60-day long-lived token.
    const long = await metaGet<{ access_token: string; expires_in: number }>(P, `${GRAPH()}/access_token`, short.access_token, {
      grant_type: "th_exchange_token",
      client_secret: requireEnv("THREADS_APP_SECRET"),
      access_token: short.access_token,
    });
    return {
      accessToken: long.access_token,
      expiresAt: expiresAt(long.expires_in),
      scopes: SCOPES,
      userId: String(short.user_id),
    };
  },

  async refresh({ accessToken }) {
    const res = await metaGet<{ access_token: string; expires_in: number }>(P, `${GRAPH()}/refresh_access_token`, accessToken, {
      grant_type: "th_refresh_token",
      access_token: accessToken,
    });
    return { accessToken: res.access_token, expiresAt: expiresAt(res.expires_in), scopes: SCOPES };
  },

  async fetchProfile(token) {
    const me = await metaGet<{ id: string; username: string; name?: string; threads_profile_picture_url?: string }>(
      P,
      `${GRAPH()}/${V}/me`,
      token,
      { fields: "id,username,name,threads_profile_picture_url" },
    );
    return {
      externalId: me.id,
      username: me.username,
      displayName: me.name ?? null,
      avatarUrl: me.threads_profile_picture_url ?? null,
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
    const base = `${GRAPH()}/${V}/${account.externalId}`;

    let containerId = ctx.state.containerId as string | undefined;
    if (containerId) {
      const s = await getStatus(token, containerId);
      if (s.status === "EXPIRED" || s.status === "ERROR") containerId = undefined; // rebuild
    }

    if (!containerId) {
      if (media.length === 0) {
        const linkAttachment = ctx.options.linkAttachment as string | undefined;
        containerId = (
          await metaPost<{ id: string }>(P, `${base}/threads`, token, {
            media_type: "TEXT",
            text: ctx.text,
            link_attachment: linkAttachment,
          })
        ).id;
      } else if (media.length === 1) {
        const m = media[0];
        const url = await ctx.mediaUrl(m);
        containerId = (
          await metaPost<{ id: string }>(P, `${base}/threads`, token, {
            media_type: m.kind === "VIDEO" ? "VIDEO" : "IMAGE",
            [m.kind === "VIDEO" ? "video_url" : "image_url"]: url,
            text: ctx.text || undefined,
          })
        ).id;
      } else {
        const children: string[] = (ctx.state.children as string[]) || [];
        for (let i = children.length; i < media.length; i++) {
          const m = media[i];
          const url = await ctx.mediaUrl(m);
          const child = await metaPost<{ id: string }>(P, `${base}/threads`, token, {
            media_type: m.kind === "VIDEO" ? "VIDEO" : "IMAGE",
            [m.kind === "VIDEO" ? "video_url" : "image_url"]: url,
            is_carousel_item: "true",
          });
          children.push(child.id);
          await ctx.saveState({ children });
        }
        for (const id of children) {
          await waitForContainer({
            platform: P,
            isVideo: media.some((m) => m.kind === "VIDEO"),
            log: ctx.log,
            getStatus: () => getStatus(token, id),
          });
        }
        containerId = (
          await metaPost<{ id: string }>(P, `${base}/threads`, token, {
            media_type: "CAROUSEL",
            children: children.join(","),
            text: ctx.text || undefined,
          })
        ).id;
      }
      await ctx.saveState({ containerId });
      await ctx.log("Created Threads container", { containerId });
    }

    const status = await waitForContainer({
      platform: P,
      isVideo: media.some((m) => m.kind === "VIDEO"),
      log: ctx.log,
      getStatus: () => getStatus(token, containerId!),
    });
    if (status === "PUBLISHED") {
      return { externalId: containerId, url: this.profileUrl(account.username) };
    }

    const published = await ctx.criticalWrite(() =>
      metaPost<{ id: string }>(P, `${base}/threads_publish`, token, { creation_id: containerId }),
    );
    await ctx.saveState({ publishedId: published.id });

    let url: string | null = null;
    try {
      const p = await metaGet<{ permalink?: string }>(P, `${GRAPH()}/${V}/${published.id}`, token, { fields: "permalink" });
      url = p.permalink ?? null;
    } catch {
      url = this.profileUrl(account.username);
    }
    return { externalId: published.id, url };
  },

  async fetchPostMetrics(account, externalId) {
    const res = await metaGet<{ data: Array<{ name: string; values?: Array<{ value: number }> }> }>(
      P,
      `${GRAPH()}/${V}/${externalId}/insights`,
      account.accessToken,
      { metric: "views,likes,replies,reposts,quotes,shares" },
    );
    const v = (n: string) => res.data.find((d) => d.name === n)?.values?.[0]?.value ?? null;
    return {
      views: v("views"),
      likes: v("likes"),
      comments: v("replies"),
      shares: sum(v("reposts"), v("quotes"), v("shares")),
      raw: res,
    };
  },

  async fetchFollowers(account) {
    const res = await metaGet<{ data: Array<{ name: string; total_value?: { value: number } }> }>(
      P,
      `${GRAPH()}/${V}/${account.externalId}/threads_insights`,
      account.accessToken,
      { metric: "followers_count" },
    );
    return res.data.find((d) => d.name === "followers_count")?.total_value?.value ?? null;
  },

  profileUrl(username) {
    return `https://www.threads.com/@${username}`;
  },
};

async function getStatus(token: string, id: string) {
  const s = await metaGet<ContainerStatusRes>(P, `${GRAPH()}/${V}/${id}`, token, { fields: "status,error_message" });
  return { status: s.status, error: s.error_message };
}

function sum(...vals: Array<number | null>): number | null {
  const nums = vals.filter((v): v is number => typeof v === "number");
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

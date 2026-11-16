import { PLATFORMS } from "../catalog";
import { expiresAt, form, platformFetch, platformJson } from "../http";
import type { PlatformAdapter, PublishContext, PublishResult } from "../types";
import { requireEnv } from "@/lib/env";

/**
 * LinkedIn Posts API (versioned REST), personal profile via w_member_social.
 * Images: POST /rest/images?action=initializeUpload -> PUT bytes to uploadUrl.
 * Post:   POST /rest/posts; the post URN is returned in the x-restli-id header.
 */
const API = "https://api.linkedin.com";
const P = "LinkedIn";
export const SCOPES = ["openid", "profile", "w_member_social"];
const VERSION = () => process.env.LINKEDIN_API_VERSION || "202610";

const restHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Linkedin-Version": VERSION(),
  "X-Restli-Protocol-Version": "2.0.0",
  "Content-Type": "application/json",
});

type TokenRes = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

const toTokens = (t: TokenRes) => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token ?? null,
  expiresAt: expiresAt(t.expires_in),
  refreshExpiresAt: expiresAt(t.refresh_token_expires_in),
  scopes: t.scope ? t.scope.split(/[ ,]/).filter(Boolean) : SCOPES,
});

export const linkedin: PlatformAdapter = {
  ...PLATFORMS.LINKEDIN,

  buildAuthUrl({ state, redirectUri }) {
    const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", requireEnv("LINKEDIN_CLIENT_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", SCOPES.join(" "));
    return u.toString();
  },

  async exchangeCode({ code, redirectUri }) {
    const t = await platformJson<TokenRes>("https://www.linkedin.com/oauth/v2/accessToken", {
      platform: P,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: requireEnv("LINKEDIN_CLIENT_ID"),
        client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
      }),
    });
    return toTokens(t);
  },

  // LinkedIn only issues refresh tokens to approved partner apps. When one is
  // present we use it; otherwise the account is flagged for reconnection
  // shortly before the 60-day token expires.
  async refresh({ refreshToken }) {
    if (!refreshToken) throw new Error("LinkedIn did not issue a refresh token; reconnect the account.");
    const t = await platformJson<TokenRes>("https://www.linkedin.com/oauth/v2/accessToken", {
      platform: P,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: requireEnv("LINKEDIN_CLIENT_ID"),
        client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
      }),
    });
    return toTokens(t);
  },

  async fetchProfile(token) {
    const u = await platformJson<{ sub: string; name?: string; given_name?: string; picture?: string; email?: string }>(
      `${API}/v2/userinfo`,
      { platform: P, headers: { Authorization: `Bearer ${token}` } },
    );
    return {
      externalId: u.sub,
      username: u.name || u.given_name || u.sub,
      displayName: u.name ?? null,
      avatarUrl: u.picture ?? null,
    };
  },

  // LinkedIn gives standard apps no way to list a member's own posts, so an
  // interrupted create can't be verified automatically.
  async reconcile(ctx) {
    return ctx.state.inFlightAt ? "unknown" : null;
  },

  async publish(ctx: PublishContext): Promise<PublishResult> {
    const token = ctx.account.accessToken;
    const author = `urn:li:person:${ctx.account.externalId}`;

    const imageUrns: Record<string, string> = (ctx.state.imageUrns as Record<string, string>) || {};
    for (const m of ctx.media) {
      if (imageUrns[m.id]) continue;
      const init = await platformJson<{ value: { uploadUrl: string; image: string } }>(
        `${API}/rest/images?action=initializeUpload`,
        {
          platform: P,
          method: "POST",
          headers: restHeaders(token),
          body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
        },
      );
      const bytes = await ctx.mediaBytes(m);
      await platformFetch(init.value.uploadUrl, {
        platform: P,
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": m.mimeType },
        body: new Uint8Array(bytes),
        timeoutMs: 120_000,
      });
      imageUrns[m.id] = init.value.image;
      await ctx.saveState({ imageUrns });
      await ctx.log("Uploaded image to LinkedIn", { urn: init.value.image });
    }

    const body: Record<string, unknown> = {
      author,
      commentary: escapeLittleText(ctx.text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    const urns = ctx.media.map((m) => imageUrns[m.id]);
    if (urns.length === 1) body.content = { media: { id: urns[0] } };
    if (urns.length > 1) body.content = { multiImage: { images: urns.map((id) => ({ id })) } };

    const res = await ctx.criticalWrite(() =>
      platformFetch(`${API}/rest/posts`, {
        platform: P,
        method: "POST",
        headers: restHeaders(token),
        body: JSON.stringify(body),
      }),
    );
    const urn = res.headers.get("x-restli-id") || "";
    return { externalId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null };
  },

  profileUrl() {
    return "https://www.linkedin.com/in/me/";
  },
};

/**
 * LinkedIn "little text" format treats these characters as markup, so they
 * must be escaped or the post is truncated/rejected.
 */
export function escapeLittleText(text: string): string {
  const escaped = text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  // Keep hashtags clickable: \#tag -> {hashtag|\#|tag}
  return escaped.replace(/(^|\s)\\#([\p{L}\p{N}_]+)/gu, (_m, pre, tag) => `${pre}{hashtag|\\#|${tag}}`);
}

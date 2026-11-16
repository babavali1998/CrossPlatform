import type { MediaKind, Platform } from "@/generated/prisma/browser";

export type PlatformId = Platform;

export type MediaRule = {
  mimeTypes: string[];
  maxBytes: number;
  maxCount: number;
  maxDurationSec?: number;
};

export type PostFormat = { id: string; label: string; description: string };

export type PlatformCapabilities = {
  textLimit: number;
  /** Platform-specific length measurement (X weights URLs/emoji, etc.). */
  countText: (text: string) => number;
  /** Can publish a post with no media. */
  allowsTextOnly: boolean;
  image: MediaRule | null;
  video: MediaRule | null;
  /** Images and videos in the same post. */
  allowsMixedMedia: boolean;
  /** Max total attachments in one post. */
  maxAttachments: number;
  hashtagLimit?: number;
  /** Sub-formats such as Instagram Feed / Reel / Story. */
  formats?: PostFormat[];
  supportsLinksPreview: boolean;
};

export type PlatformInfo = {
  id: PlatformId;
  name: string;
  /** Brand color for UI accents. */
  color: string;
  /** "available" adapters publish for real; "planned" ones are listed but disabled. */
  status: "available" | "planned";
  capabilities: PlatformCapabilities;
  /** Human-readable requirements (developer app, approvals, account type). */
  requirements: string[];
  /** Features this adapter cannot do (yet), shown in the UI. */
  limitations: string[];
  /** Env vars required for this platform to be connectable. */
  envKeys: string[];
  analytics: "supported" | "opt-in" | "unsupported";
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  scopes: string[];
  /** Some providers return the user id with the token. */
  userId?: string;
};

export type Profile = {
  externalId: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  followers?: number | null;
};

export type PublishMedia = {
  id: string;
  key: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
};

export type AccountContext = {
  id: string;
  externalId: string;
  username: string;
  accessToken: string;
  settings: Record<string, unknown>;
};

export type PublishContext = {
  account: AccountContext;
  text: string;
  media: PublishMedia[];
  options: Record<string, unknown>;
  /** Resumable progress persisted on the PostTarget. */
  state: Record<string, unknown>;
  saveState: (patch: Record<string, unknown>) => Promise<void>;
  log: (message: string, data?: unknown) => Promise<void>;
  /** Public URL a platform can download the media from. */
  mediaUrl: (media: PublishMedia) => Promise<string>;
  /** Raw bytes for platforms that take uploads (X, LinkedIn). */
  mediaBytes: (media: PublishMedia) => Promise<Buffer>;
  /** JPEG URL for platforms that only accept JPEG (Instagram). */
  jpegUrl: (media: PublishMedia) => Promise<string>;
  /**
   * Wraps the single non-idempotent "create the post" call. If it fails
   * without a definite answer from the platform (timeout, dropped
   * connection), the target is marked OUTCOME_UNKNOWN instead of being
   * retried blindly, so a post is never duplicated.
   */
  criticalWrite: <T>(fn: () => Promise<T>) => Promise<T>;
};

export type PublishResult = { externalId: string; url: string | null };

export type PostMetrics = {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  reach?: number | null;
  saves?: number | null;
  raw?: unknown;
};

export interface PlatformAdapter extends PlatformInfo {
  buildAuthUrl(args: { state: string; redirectUri: string; codeChallenge?: string }): string;
  usesPkce?: boolean;
  exchangeCode(args: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthTokens>;
  /** Refresh or extend a token. Called by the worker before it expires. */
  refresh?(tokens: { accessToken: string; refreshToken?: string | null }): Promise<OAuthTokens>;
  fetchProfile(accessToken: string, hint?: { userId?: string }): Promise<Profile>;
  publish(ctx: PublishContext): Promise<PublishResult>;
  /**
   * Called before publishing when a previous attempt may have created the
   * post. Returns the existing post if found, null if definitely not created,
   * or "unknown" if it cannot tell.
   */
  reconcile?(ctx: PublishContext): Promise<PublishResult | null | "unknown">;
  fetchPostMetrics?(account: AccountContext, externalId: string): Promise<PostMetrics | null>;
  fetchFollowers?(account: AccountContext): Promise<number | null>;
  profileUrl(username: string): string;
}

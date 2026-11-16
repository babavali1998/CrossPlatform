/**
 * Client-safe platform catalog: names, limits and requirements.
 * Server-side OAuth and publishing live in ./adapters.
 * Values checked against platform docs in November 2026.
 */
import type { Platform } from "@/generated/prisma/browser";
import type { PlatformInfo } from "./types";
import { countCodePoints, countThreads, countX } from "./text";

const MB = 1024 * 1024;

export const PLATFORM_ORDER: Platform[] = [
  "INSTAGRAM",
  "THREADS",
  "X",
  "LINKEDIN",
  "FACEBOOK",
  "TIKTOK",
  "YOUTUBE",
  "PINTEREST",
  "BLUESKY",
];

export const PLATFORMS: Record<Platform, PlatformInfo> = {
  INSTAGRAM: {
    id: "INSTAGRAM",
    name: "Instagram",
    color: "#E1306C",
    status: "available",
    analytics: "supported",
    envKeys: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
    capabilities: {
      textLimit: 2200,
      countText: countCodePoints,
      allowsTextOnly: false,
      image: { mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 8 * MB, maxCount: 10 },
      video: { mimeTypes: ["video/mp4", "video/quicktime"], maxBytes: 300 * MB, maxCount: 10, maxDurationSec: 15 * 60 },
      allowsMixedMedia: true,
      maxAttachments: 10,
      hashtagLimit: 30,
      supportsLinksPreview: false,
      formats: [
        { id: "FEED", label: "Feed post", description: "Single photo/video or a carousel of up to 10." },
        { id: "REEL", label: "Reel", description: "One vertical video." },
        { id: "STORY", label: "Story", description: "One photo or video. Captions are not shown on Stories." },
      ],
    },
    requirements: [
      "An Instagram professional account (Business or Creator).",
      "A Meta app with the Instagram API (Instagram Login) product.",
      "Permissions instagram_business_basic and instagram_business_content_publish. Until Meta grants Advanced Access through App Review, only accounts added as app testers can publish.",
      "Media must be reachable on a public URL (set S3_PUBLIC_BASE_URL or use a public bucket/CDN). Localhost storage will not work.",
    ],
    limitations: [
      "Instagram requires at least one photo or video. Text-only posts are not possible.",
      "PNG/WebP images are converted to JPEG automatically (Instagram accepts JPEG only).",
      "Shopping tags, music and filters are not available through the API.",
      "100 API-published posts per account per rolling 24 hours.",
    ],
  },
  THREADS: {
    id: "THREADS",
    name: "Threads",
    color: "#111111",
    status: "available",
    analytics: "supported",
    envKeys: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
    capabilities: {
      textLimit: 500,
      countText: countThreads,
      allowsTextOnly: true,
      image: { mimeTypes: ["image/jpeg", "image/png"], maxBytes: 8 * MB, maxCount: 20 },
      video: { mimeTypes: ["video/mp4", "video/quicktime"], maxBytes: 1024 * MB, maxCount: 20, maxDurationSec: 5 * 60 },
      allowsMixedMedia: true,
      maxAttachments: 20,
      supportsLinksPreview: true,
    },
    requirements: [
      "A Meta app with the Threads API use case.",
      "Permissions threads_basic and threads_content_publish (plus threads_manage_insights for analytics). Without Advanced Access, only Threads testers on your app can publish.",
      "Media must be reachable on a public URL.",
    ],
    limitations: ["500 characters; emoji count by their byte length.", "250 posts per profile per rolling 24 hours."],
  },
  X: {
    id: "X",
    name: "X",
    color: "#000000",
    status: "available",
    analytics: "opt-in",
    envKeys: ["X_CLIENT_ID"],
    capabilities: {
      textLimit: 280,
      countText: countX,
      allowsTextOnly: true,
      image: { mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"], maxBytes: 5 * MB, maxCount: 4 },
      video: { mimeTypes: ["video/mp4", "video/quicktime"], maxBytes: 512 * MB, maxCount: 1, maxDurationSec: 140 },
      allowsMixedMedia: false,
      maxAttachments: 4,
      supportsLinksPreview: true,
    },
    requirements: [
      "An X developer account with an app inside a Project, OAuth 2.0 enabled, scopes tweet.read tweet.write users.read media.write offline.access.",
      "X API access is pay-per-use: roughly $0.015 per post, $0.20 per post containing a link (Oct 2026 pricing; check your Developer Console).",
    ],
    limitations: [
      "280 weighted characters by default (URLs count as 23). Raise the limit per account in Accounts if it has X Premium.",
      "Up to 4 images, or 1 video, per post. Images and video cannot be mixed.",
      "Analytics reads are billed by X, so they are off unless X_ENABLE_METRICS=true.",
    ],
  },
  LINKEDIN: {
    id: "LINKEDIN",
    name: "LinkedIn",
    color: "#0A66C2",
    status: "available",
    analytics: "unsupported",
    envKeys: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    capabilities: {
      textLimit: 3000,
      countText: countCodePoints,
      allowsTextOnly: true,
      image: { mimeTypes: ["image/jpeg", "image/png", "image/gif"], maxBytes: 8 * MB, maxCount: 20 },
      video: null,
      allowsMixedMedia: false,
      maxAttachments: 20,
      supportsLinksPreview: false,
    },
    requirements: [
      'A LinkedIn developer app with the "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" products (self-serve).',
      "Posts are published to your personal profile (w_member_social).",
    ],
    limitations: [
      "Company Page posting needs the Community Management API (w_organization_social), which requires LinkedIn approval. Not included in this MVP.",
      "Video upload is not implemented yet. Text and image posts only.",
      "Post analytics for personal profiles are not available to standard apps.",
    ],
  },
  FACEBOOK: planned("FACEBOOK", "Facebook", "#1877F2", "Page publishing via the Pages API. Personal profile posting is not available through Meta's API."),
  TIKTOK: planned("TIKTOK", "TikTok", "#000000", "Content Posting API; public posting requires TikTok's app audit."),
  YOUTUBE: planned("YOUTUBE", "YouTube", "#FF0000", "YouTube Data API v3 uploads; unverified apps upload as private."),
  PINTEREST: planned("PINTEREST", "Pinterest", "#E60023", "Pinterest API v5 pins; needs standard access approval."),
  BLUESKY: planned("BLUESKY", "Bluesky", "#0085FF", "AT Protocol; straightforward to add next."),
};

function planned(id: Platform, name: string, color: string, note: string): PlatformInfo {
  return {
    id,
    name,
    color,
    status: "planned",
    analytics: "unsupported",
    envKeys: [],
    capabilities: {
      textLimit: 0,
      countText: countCodePoints,
      allowsTextOnly: false,
      image: null,
      video: null,
      allowsMixedMedia: false,
      maxAttachments: 0,
      supportsLinksPreview: false,
    },
    requirements: [note],
    limitations: ["Not implemented yet. Listed so you can see what's coming; it cannot be connected or selected."],
  };
}

/** Effective text limit for an account (X Premium can raise it). */
export function textLimitFor(platform: Platform, settings?: Record<string, unknown> | null): number {
  const base = PLATFORMS[platform].capabilities.textLimit;
  const override = Number(settings?.maxChars);
  return Number.isFinite(override) && override > 0 ? override : base;
}

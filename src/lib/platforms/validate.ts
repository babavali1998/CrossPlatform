import type { MediaKind, Platform } from "@/generated/prisma/browser";
import { PLATFORMS, textLimitFor } from "./catalog";
import { countHashtags } from "./text";

export type MediaSummary = {
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  length: number;
  limit: number;
};

const fmtMB = (b: number) => `${Math.round(b / (1024 * 1024))} MB`;

/**
 * Checks whether a piece of content can be published on a platform.
 * Used by the composer (live badges) and again by the API before queueing,
 * so the worker never sends content a platform is known to reject.
 */
export function validateForPlatform(
  platform: Platform,
  text: string,
  media: MediaSummary[],
  opts: { options?: Record<string, unknown>; accountSettings?: Record<string, unknown> | null } = {},
): ValidationResult {
  const info = PLATFORMS[platform];
  const cap = info.capabilities;
  const errors: string[] = [];
  const warnings: string[] = [];
  const limit = textLimitFor(platform, opts.accountSettings);
  const length = cap.countText(text);

  if (info.status !== "available") {
    return { ok: false, errors: [`${info.name} is not supported yet.`], warnings, length, limit };
  }

  const images = media.filter((m) => m.kind === "IMAGE");
  const videos = media.filter((m) => m.kind === "VIDEO");

  if (length > limit) errors.push(`Text is ${length}/${limit} characters.`);
  if (!text.trim() && media.length === 0) errors.push("Add some text or media.");
  if (media.length === 0 && !cap.allowsTextOnly) errors.push(`${info.name} needs at least one photo or video.`);
  if (media.length > cap.maxAttachments) errors.push(`${info.name} allows at most ${cap.maxAttachments} attachments.`);
  if (images.length && videos.length && !cap.allowsMixedMedia) {
    errors.push(`${info.name} can't mix photos and videos in one post.`);
  }
  if (cap.hashtagLimit && countHashtags(text) > cap.hashtagLimit) {
    errors.push(`${info.name} allows at most ${cap.hashtagLimit} hashtags.`);
  }

  for (const [kind, list, rule] of [
    ["photo", images, cap.image],
    ["video", videos, cap.video],
  ] as const) {
    if (!list.length) continue;
    if (!rule) {
      errors.push(`${info.name} ${kind}s aren't supported here yet.`);
      continue;
    }
    if (list.length > rule.maxCount) errors.push(`${info.name} allows at most ${rule.maxCount} ${kind}s.`);
    for (const m of list) {
      if (!rule.mimeTypes.includes(m.mimeType)) errors.push(`${info.name} doesn't accept ${m.mimeType}.`);
      if (m.sizeBytes > rule.maxBytes) errors.push(`A ${kind} is larger than ${info.name}'s ${fmtMB(rule.maxBytes)} limit.`);
      if (rule.maxDurationSec && m.durationSec && m.durationSec > rule.maxDurationSec) {
        errors.push(`A video is longer than ${info.name}'s ${Math.round(rule.maxDurationSec / 60)} min limit.`);
      }
    }
  }

  // Platform-specific rules
  if (platform === "INSTAGRAM") {
    const format = String(opts.options?.igFormat || "FEED");
    if (format === "REEL" && (videos.length !== 1 || images.length)) errors.push("A Reel needs exactly one video.");
    if (format === "STORY") {
      if (media.length !== 1) errors.push("A Story needs exactly one photo or video.");
      if (text.trim()) warnings.push("Instagram doesn't show captions on Stories.");
    }
    if (format === "FEED") {
      for (const m of images) {
        if (m.width && m.height) {
          const r = m.width / m.height;
          if (r < 0.8 || r > 1.91) warnings.push("Instagram feed photos should be between 4:5 and 1.91:1. This one will be rejected or cropped.");
        }
      }
      if (media.length > 1) warnings.push("Carousel photos are cropped to the first item's aspect ratio.");
    }
  }
  return { ok: errors.length === 0, errors: dedupe(errors), warnings: dedupe(warnings), length, limit };
}

function dedupe(a: string[]) {
  return [...new Set(a)];
}

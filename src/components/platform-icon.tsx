import { siBluesky, siFacebook, siInstagram, siPinterest, siThreads, siTiktok, siX, siYoutube } from "simple-icons";
import type { Platform } from "@/generated/prisma/browser";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { cn } from "@/lib/utils";

const PATHS: Partial<Record<Platform, string>> = {
  INSTAGRAM: siInstagram.path,
  THREADS: siThreads.path,
  X: siX.path,
  FACEBOOK: siFacebook.path,
  TIKTOK: siTiktok.path,
  YOUTUBE: siYoutube.path,
  PINTEREST: siPinterest.path,
  BLUESKY: siBluesky.path,
};

/** Brand mark in a rounded tile. `plain` renders the glyph only. */
export function PlatformIcon({
  platform,
  className,
  plain = false,
}: {
  platform: Platform;
  className?: string;
  plain?: boolean;
}) {
  const color = PLATFORMS[platform].color;
  const path = PATHS[platform];
  const glyph = path ? (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[60%]" fill="currentColor">
      <path d={path} />
    </svg>
  ) : (
    // LinkedIn's mark isn't in simple-icons; a plain "in" wordmark stands in.
    <span aria-hidden className="text-[0.62em] font-bold leading-none tracking-tight">
      in
    </span>
  );
  if (plain) {
    return (
      <span className={cn("inline-flex size-4 items-center justify-center", className)} style={{ color }}>
        {glyph}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={PLATFORMS[platform].name}
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-white", className)}
      style={{ background: color }}
    >
      {glyph}
    </span>
  );
}

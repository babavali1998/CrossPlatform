import type { Platform } from "@/generated/prisma/client";
import type { PlatformAdapter } from "./types";
import { PLATFORMS } from "./catalog";
import { instagram } from "./adapters/instagram";
import { threads } from "./adapters/threads";
import { x } from "./adapters/x";
import { linkedin } from "./adapters/linkedin";

/**
 * To add a platform: implement PlatformAdapter in ./adapters/<name>.ts,
 * flip its catalog entry to status "available", and register it here.
 */
const ADAPTERS: Partial<Record<Platform, PlatformAdapter>> = {
  INSTAGRAM: instagram,
  THREADS: threads,
  X: x,
  LINKEDIN: linkedin,
};

export function getAdapter(platform: Platform): PlatformAdapter {
  const a = ADAPTERS[platform];
  if (!a) throw new Error(`${PLATFORMS[platform].name} is not supported yet`);
  return a;
}

export function hasAdapter(platform: Platform): boolean {
  return !!ADAPTERS[platform];
}

/** True when the server has the credentials needed to connect this platform. */
export function isConfigured(platform: Platform): boolean {
  const info = PLATFORMS[platform];
  return info.status === "available" && info.envKeys.every((k) => !!process.env[k]?.trim());
}

export function platformSlug(p: Platform): string {
  return p.toLowerCase();
}

export function platformFromSlug(slug: string): Platform | null {
  const up = slug.toUpperCase() as Platform;
  return up in PLATFORMS ? up : null;
}

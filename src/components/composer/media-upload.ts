"use client";

import { api } from "@/lib/utils";

export type MediaItem = {
  key: string; // local key for React
  id?: string; // server MediaAsset id once registered
  name: string;
  kind: "IMAGE" | "VIDEO";
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  error?: string;
};

async function probe(file: File): Promise<{ width?: number; height?: number; durationSec?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = url;
      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error("Can't read video"));
      });
      return { width: v.videoWidth, height: v.videoHeight, durationSec: Number.isFinite(v.duration) ? v.duration : undefined };
    }
  } catch {
    /* metadata is optional */
  } finally {
    URL.revokeObjectURL(url);
  }
  return {};
}

export function localItem(file: File): MediaItem {
  return {
    key: crypto.randomUUID(),
    name: file.name,
    kind: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: URL.createObjectURL(file),
    status: "uploading",
    progress: 0,
  };
}

/** Registers the file, uploads it straight to storage, then confirms. */
export async function uploadFile(file: File, onUpdate: (patch: Partial<MediaItem>) => void) {
  try {
    const meta = await probe(file);
    onUpdate(meta);
    const { media, uploadUrl } = await api<{ media: { id: string }; uploadUrl: string }>("/api/media", {
      method: "POST",
      json: { fileName: file.name, mimeType: file.type, sizeBytes: file.size, ...meta },
    });
    onUpdate({ id: media.id });

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => e.lengthComputable && onUpdate({ progress: e.loaded / e.total });
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Storage upload failed (${xhr.status})`)));
      xhr.onerror = () => reject(new Error("Storage upload failed. Check the bucket's CORS settings."));
      xhr.send(file);
    });

    await api("/api/media", { method: "PATCH", json: { id: media.id } });
    onUpdate({ status: "ready", progress: 1 });
  } catch (e) {
    onUpdate({ status: "error", error: (e as Error).message });
  }
}

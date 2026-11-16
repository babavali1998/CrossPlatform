"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ImagePlus, Loader2, RotateCcw, Sparkles, Trash2, TriangleAlert, X as Close } from "lucide-react";
import type { Platform } from "@/generated/prisma/browser";
import { PLATFORMS } from "@/lib/platforms/catalog";
import { validateForPlatform, type ValidationResult } from "@/lib/platforms/validate";
import { api, cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/field";
import { Badge, Panel } from "@/components/ui/misc";
import { PlatformIcon } from "@/components/platform-icon";
import { PlatformPreview } from "./preview";
import { localItem, uploadFile, type MediaItem } from "./media-upload";

export type ComposerAccount = {
  id: string;
  platform: Platform;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: "ACTIVE" | "NEEDS_RECONNECT" | "REVOKED";
  settings: Record<string, unknown>;
};

export type ComposerInitial = {
  postId: string;
  status: string;
  baseText: string;
  mode: "ORIGINAL" | "AI_OPTIMIZED";
  media: Array<Omit<MediaItem, "key" | "previewUrl" | "status" | "progress"> & { id: string }>;
  targets: Array<{ socialAccountId: string; text: string; options: Record<string, unknown> }>;
  scheduledAt: string | null;
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  recurrenceEndsAt: string | null;
};

type Version = { text: string; edited: boolean; notes?: string };
type Issue = { socialAccountId: string; errors: string[] };

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function Composer({
  accounts,
  aiEnabled,
  initial,
}: {
  accounts: ComposerAccount[];
  aiEnabled: boolean;
  initial?: ComposerInitial;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [baseText, setBaseText] = useState(initial?.baseText ?? "");
  const [media, setMedia] = useState<MediaItem[]>(
    () =>
      initial?.media.map((m) => ({
        ...m,
        key: m.id,
        previewUrl: `/api/media/${m.id}`,
        status: "ready" as const,
        progress: 1,
      })) ?? [],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial?.targets.map((t) => t.socialAccountId) ?? []));
  const [mode, setMode] = useState<"ORIGINAL" | "AI_OPTIMIZED">(initial?.mode ?? "ORIGINAL");
  const [versions, setVersions] = useState<Record<string, Version>>(() =>
    Object.fromEntries(
      (initial?.targets ?? [])
        .filter((t) => t.text !== initial?.baseText)
        .map((t) => [t.socialAccountId, { text: t.text, edited: true }]),
    ),
  );
  const [options, setOptions] = useState<Record<string, Record<string, unknown>>>(() =>
    Object.fromEntries((initial?.targets ?? []).map((t) => [t.socialAccountId, t.options])),
  );
  const [timing, setTiming] = useState<"now" | "schedule">(initial?.scheduledAt && initial.status === "SCHEDULED" ? "schedule" : "now");
  const [scheduledLocal, setScheduledLocal] = useState(toLocalInput(initial?.scheduledAt ?? null));
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? "NONE");
  const [recurrenceEnds, setRecurrenceEnds] = useState(toLocalInput(initial?.recurrenceEndsAt ?? null).slice(0, 10));
  const [tone, setTone] = useState("");
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState<null | "draft" | "go">(null);
  const [serverIssues, setServerIssues] = useState<{ snapshot: string; issues: Issue[] }>({ snapshot: "", issues: [] });
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openLane, setOpenLane] = useState<string | null>(null);

  const usable = useMemo(() => accounts.filter((a) => PLATFORMS[a.platform].status === "available"), [accounts]);
  const selectedAccounts = usable.filter((a) => selected.has(a.id));

  const textFor = useCallback(
    (id: string) => {
      const v = versions[id];
      if (v && (v.edited || mode === "AI_OPTIMIZED")) return v.text;
      return baseText;
    },
    [versions, mode, baseText],
  );

  const mediaSummaries = useMemo(
    () => media.filter((m) => m.status !== "error").map((m) => ({ ...m })),
    [media],
  );

  const validation = useMemo(() => {
    const out: Record<string, ValidationResult> = {};
    for (const a of usable) {
      out[a.id] = validateForPlatform(a.platform, textFor(a.id), mediaSummaries, {
        options: options[a.id],
        accountSettings: a.settings,
      });
    }
    return out;
  }, [usable, textFor, mediaSummaries, options]);

  const uploading = media.some((m) => m.status === "uploading");
  const blocked = selectedAccounts.filter((a) => !validation[a.id]?.ok || a.status !== "ACTIVE");
  const preview = selectedAccounts.find((a) => a.id === previewId) ?? selectedAccounts[0];

  // Server-side issues only apply to the exact content that was submitted.
  const snapshot = JSON.stringify([baseText, media.map((m) => m.key), [...selected], versions, options]);
  const activeIssues = serverIssues.snapshot === snapshot ? serverIssues.issues : [];

  // --- media -------------------------------------------------------------
  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime))$/.test(file.type)) {
        toast.error(`${file.name}: use JPG, PNG, WebP, GIF, MP4 or MOV`);
        continue;
      }
      const item = localItem(file);
      setMedia((m) => [...m, item]);
      void uploadFile(file, (patch) => setMedia((all) => all.map((x) => (x.key === item.key ? { ...x, ...patch } : x))));
    }
  };
  const removeMedia = (key: string) => setMedia((m) => m.filter((x) => x.key !== key));
  const moveMedia = (key: string, dir: -1 | 1) =>
    setMedia((m) => {
      const i = m.findIndex((x) => x.key === key);
      const j = i + dir;
      if (j < 0 || j >= m.length) return m;
      const copy = [...m];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  // --- selection ---------------------------------------------------------
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectAll = () => setSelected(new Set(usable.filter((a) => a.status === "ACTIVE").map((a) => a.id)));
  const deselectAll = () => setSelected(new Set());

  // --- AI ----------------------------------------------------------------
  const generate = async () => {
    if (!baseText.trim()) return toast.error("Write the original post first");
    if (!selectedAccounts.length) return toast.error("Select at least one account");
    setGenerating(true);
    try {
      const { versions: out } = await api<{ versions: Array<{ socialAccountId: string; text: string; notes?: string }> }>(
        "/api/ai/adapt",
        {
          method: "POST",
          json: {
            text: baseText,
            tone: tone || undefined,
            mediaIds: media.filter((m) => m.id).map((m) => m.id),
            targets: selectedAccounts.map((a) => ({ socialAccountId: a.id, format: options[a.id]?.igFormat })),
          },
        },
      );
      setVersions((v) => ({ ...v, ...Object.fromEntries(out.map((o) => [o.socialAccountId, { text: o.text, edited: false, notes: o.notes }])) }));
      setMode("AI_OPTIMIZED");
      toast.success("Versions ready. Review each one before publishing.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  // --- submit ------------------------------------------------------------
  const submit = async (action: "draft" | "publish" | "schedule") => {
    if (uploading) return toast.error("Wait for uploads to finish");
    if (media.some((m) => m.status === "error")) return toast.error("Remove the files that failed to upload");
    let scheduledAt: string | null = null;
    if (action === "schedule") {
      if (!scheduledLocal) return toast.error("Pick a date and time");
      scheduledAt = new Date(scheduledLocal).toISOString();
    } else if (timing === "schedule" && scheduledLocal) {
      scheduledAt = new Date(scheduledLocal).toISOString();
    }
    const body = {
      baseText,
      mode,
      mediaIds: media.map((m) => m.id!).filter(Boolean),
      targets: selectedAccounts.map((a) => ({ socialAccountId: a.id, text: textFor(a.id), options: options[a.id] ?? {} })),
      action,
      scheduledAt,
      recurrence: action === "schedule" || timing === "schedule" ? recurrence : "NONE",
      recurrenceEndsAt: recurrence !== "NONE" && recurrenceEnds ? new Date(`${recurrenceEnds}T23:59:59`).toISOString() : null,
    };
    setSubmitting(action === "draft" ? "draft" : "go");
    try {
      const { post } = await api<{ post: { id: string } }>(initial ? `/api/posts/${initial.postId}` : "/api/posts", {
        method: initial ? "PUT" : "POST",
        json: body,
      });
      if (action === "draft") {
        toast.success("Draft saved");
        router.push("/drafts");
      } else if (action === "schedule") {
        toast.success(`Scheduled for ${new Date(scheduledAt!).toLocaleString()}`);
        router.push("/scheduled");
      } else {
        router.push(`/posts/${post.id}`);
      }
      router.refresh();
    } catch (e) {
      const err = e as Error & { data?: { issues?: Issue[] } };
      if (err.data?.issues) setServerIssues({ snapshot, issues: err.data.issues });
      toast.error(err.message);
      setSubmitting(null);
    }
  };

  const n = selectedAccounts.length;
  const primaryLabel =
    timing === "schedule" ? `Schedule for ${n} ${n === 1 ? "platform" : "platforms"}` : `Publish to ${n} ${n === 1 ? "platform" : "platforms"}`;

  if (!usable.length) {
    return (
      <Panel className="px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">Connect an account to start posting</h2>
        <p className="mx-auto mt-1 max-w-md text-slate">Instagram, Threads, X and LinkedIn are supported now.</p>
        <Button asChild variant="primary" className="mt-5">
          <Link href="/accounts">Connect accounts</Link>
        </Button>
      </Panel>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        {/* Editor */}
        <Panel
          className="p-4 md:p-5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          <Label htmlFor="base-text">Your post</Label>
          <Textarea
            id="base-text"
            value={baseText}
            onChange={(e) => setBaseText(e.target.value)}
            placeholder="What do you want to share? Add hashtags and links here too."
            className="mt-1.5 min-h-40 border-none bg-transparent px-0 text-[16px] focus-visible:outline-none"
          />
          {media.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2.5">
              {media.map((m, i) => (
                <li key={m.key} className="group relative size-24 overflow-hidden rounded-lg border border-line bg-paper">
                  {m.kind === "VIDEO" ? (
                    <video src={m.previewUrl} className="size-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.previewUrl} alt={m.name} className="size-full object-cover" />
                  )}
                  {m.status === "uploading" && (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
                      <div className="h-full bg-signal transition-[width]" style={{ width: `${Math.round(m.progress * 100)}%` }} />
                    </div>
                  )}
                  {m.status === "error" && (
                    <div className="absolute inset-0 grid place-items-center bg-bad/80 p-1 text-center text-[11px] text-white" title={m.error}>
                      Upload failed
                    </div>
                  )}
                  <div className="absolute inset-x-0 top-0 flex justify-between p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <span className="flex gap-0.5">
                      {i > 0 && (
                        <button className="rounded bg-black/60 px-1 text-xs text-white" onClick={() => moveMedia(m.key, -1)} aria-label="Move earlier">
                          ‹
                        </button>
                      )}
                      {i < media.length - 1 && (
                        <button className="rounded bg-black/60 px-1 text-xs text-white" onClick={() => moveMedia(m.key, 1)} aria-label="Move later">
                          ›
                        </button>
                      )}
                    </span>
                    <button className="rounded bg-black/60 p-0.5 text-white" onClick={() => removeMedia(m.key)} aria-label={`Remove ${m.name}`}>
                      <Close className="size-3.5" />
                    </button>
                  </div>
                  <span className="sr-only">
                    {m.name}, {formatBytes(m.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              <ImagePlus /> Add photos or video
            </Button>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <span className="text-[13px] text-muted">or drop files here</span>
          </div>
        </Panel>

        {/* Mode */}
        <Panel className="p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Content mode" className="inline-flex rounded-lg border border-line-strong p-0.5">
              {(
                [
                  ["ORIGINAL", "Original"],
                  ["AI_OPTIMIZED", "AI optimized"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn("rounded-md px-3 py-1.5 text-sm", mode === value ? "bg-ink text-surface" : "text-slate hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="min-w-0 flex-1 text-[13px] text-slate">
              {mode === "ORIGINAL"
                ? "The same text goes everywhere. Edit any platform's version below if it needs to be different."
                : "AI writes a version for each selected platform. You review and edit every one before anything is posted."}
            </p>
          </div>
          {mode === "AI_OPTIMIZED" && (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Label htmlFor="tone">Tone (optional)</Label>
                <Input id="tone" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. friendly, local shop, no hype" className="mt-1" />
              </div>
              <Button variant="primary" onClick={generate} disabled={!aiEnabled || generating}>
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {Object.keys(versions).length ? "Regenerate versions" : "Generate versions"}
              </Button>
              {!aiEnabled && <p className="w-full text-[13px] text-warn">AI is off. Set OPENAI_API_KEY on the server to use it.</p>}
            </div>
          )}
        </Panel>

        {/* Lanes */}
        <section aria-labelledby="lanes-heading">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="lanes-heading" className="text-[17px] font-semibold">
              Where to post
            </h2>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={selectAll}>
                Select all
              </Button>
              <Button size="sm" variant="ghost" onClick={deselectAll}>
                Deselect all
              </Button>
            </div>
          </div>
          <ul className="space-y-2">
            {usable.map((a) => (
              <Lane
                key={a.id}
                account={a}
                checked={selected.has(a.id)}
                onToggle={() => toggle(a.id)}
                open={openLane === a.id}
                onOpen={() => setOpenLane(openLane === a.id ? null : a.id)}
                text={textFor(a.id)}
                version={versions[a.id]}
                mode={mode}
                validation={validation[a.id]}
                serverErrors={activeIssues.find((i) => i.socialAccountId === a.id)?.errors}
                options={options[a.id] ?? {}}
                onOptions={(o) => setOptions((all) => ({ ...all, [a.id]: { ...all[a.id], ...o } }))}
                onText={(t) => setVersions((v) => ({ ...v, [a.id]: { text: t, edited: true, notes: v[a.id]?.notes } }))}
                onReset={() =>
                  setVersions((v) => {
                    const c = { ...v };
                    delete c[a.id];
                    return c;
                  })
                }
              />
            ))}
          </ul>
        </section>

        {/* Timing + actions */}
        <Panel className="z-10 p-4 md:sticky md:bottom-3 md:shadow-[0_8px_30px_-12px_rgba(20,23,28,0.25)]">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="timing">When</Label>
              <Select id="timing" className="mt-1 w-40" value={timing} onChange={(e) => setTiming(e.target.value as "now" | "schedule")}>
                <option value="now">Publish now</option>
                <option value="schedule">Schedule</option>
              </Select>
            </div>
            {timing === "schedule" && (
              <>
                <div>
                  <Label htmlFor="when">Date and time</Label>
                  <Input
                    id="when"
                    type="datetime-local"
                    className="mt-1 w-56"
                    value={scheduledLocal}
                    min={toLocalInput(new Date().toISOString())}
                    onChange={(e) => setScheduledLocal(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="repeat">Repeat</Label>
                  <Select id="repeat" className="mt-1 w-36" value={recurrence} onChange={(e) => setRecurrence(e.target.value as typeof recurrence)}>
                    <option value="NONE">Don’t repeat</option>
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                  </Select>
                </div>
                {recurrence !== "NONE" && (
                  <div>
                    <Label htmlFor="until">Until (optional)</Label>
                    <Input id="until" type="date" className="mt-1 w-44" value={recurrenceEnds} onChange={(e) => setRecurrenceEnds(e.target.value)} />
                  </div>
                )}
              </>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button onClick={() => submit("draft")} disabled={!!submitting}>
                {submitting === "draft" && <Loader2 className="animate-spin" />}
                Save draft
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={() => submit(timing === "schedule" ? "schedule" : "publish")}
                disabled={!!submitting || n === 0 || blocked.length > 0 || uploading}
              >
                {submitting === "go" && <Loader2 className="animate-spin" />}
                {primaryLabel}
              </Button>
            </div>
          </div>
          {blocked.length > 0 && (
            <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-warn">
              <TriangleAlert className="size-4" />
              Fix {blocked.map((a) => PLATFORMS[a.platform].name).join(", ")} before publishing, or deselect {blocked.length === 1 ? "it" : "them"}.
            </p>
          )}
          {timing === "schedule" && (
            <p className="mt-2 text-[13px] text-muted">Times are in your browser’s timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
          )}
        </Panel>
      </div>

      {/* Preview */}
      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start" aria-label="Preview">
        <h2 className="mb-2 text-[17px] font-semibold">Preview</h2>
        {selectedAccounts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-slate">
            Select a platform to see how the post will look.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
              {selectedAccounts.map((a) => (
                <button
                  key={a.id}
                  role="tab"
                  aria-selected={preview?.id === a.id}
                  onClick={() => setPreviewId(a.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]",
                    preview?.id === a.id ? "border-ink bg-ink text-surface" : "border-line-strong text-slate hover:text-ink",
                  )}
                >
                  <PlatformIcon platform={a.platform} plain className={preview?.id === a.id ? "text-surface" : ""} />
                  {PLATFORMS[a.platform].name}
                </button>
              ))}
            </div>
            {preview && (
              <PlatformPreview
                platform={preview.platform}
                username={preview.username}
                displayName={preview.displayName}
                avatarUrl={preview.avatarUrl}
                text={textFor(preview.id)}
                media={media.filter((m) => m.status !== "error")}
                igFormat={String(options[preview.id]?.igFormat ?? "FEED")}
              />
            )}
            <p className="mt-2 text-xs text-muted">Approximate. Each platform renders the final post its own way.</p>
          </>
        )}
      </aside>
    </div>
  );
}

function Lane(props: {
  account: ComposerAccount;
  checked: boolean;
  onToggle: () => void;
  open: boolean;
  onOpen: () => void;
  text: string;
  version?: Version;
  mode: "ORIGINAL" | "AI_OPTIMIZED";
  validation?: ValidationResult;
  serverErrors?: string[];
  options: Record<string, unknown>;
  onOptions: (o: Record<string, unknown>) => void;
  onText: (t: string) => void;
  onReset: () => void;
}) {
  const { account: a, validation: v } = props;
  const info = PLATFORMS[a.platform];
  const disconnected = a.status !== "ACTIVE";
  const ratio = v ? Math.min(1, v.length / Math.max(1, v.limit)) : 0;
  const over = v ? v.length > v.limit : false;
  const errors = [...(v?.errors ?? []), ...(props.serverErrors ?? [])];
  const customized = props.version?.edited || (props.mode === "AI_OPTIMIZED" && props.version);
  const id = `lane-${a.id}`;

  return (
    <li className={cn("rounded-xl border bg-surface transition-colors", props.checked ? "border-line-strong" : "border-line")}>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Checkbox id={id} checked={props.checked} onCheckedChange={props.onToggle} disabled={disconnected} aria-describedby={`${id}-status`} />
        <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <PlatformIcon platform={a.platform} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{info.name}</span>
            <span className="block truncate text-[13px] text-slate">@{a.username}</span>
          </span>
        </label>

        {/* Fit meter: how much of this platform's limit the text uses */}
        <div className="hidden w-28 sm:block" aria-hidden>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className={cn("h-full rounded-full", over ? "bg-bad" : ratio > 0.9 ? "bg-warn" : "bg-signal")}
              style={{ width: `${Math.max(2, ratio * 100)}%` }}
            />
          </div>
          <p className={cn("mt-1 text-right text-xs tabular-nums", over ? "text-bad" : "text-muted")}>
            {v?.length ?? 0}/{v?.limit ?? info.capabilities.textLimit}
          </p>
        </div>

        <span id={`${id}-status`} className="shrink-0">
          {disconnected ? (
            <Badge tone="warn">Reconnect</Badge>
          ) : !props.checked ? null : errors.length ? (
            <Badge tone="bad">Needs changes</Badge>
          ) : customized ? (
            <Badge tone="signal">Custom</Badge>
          ) : (
            <Badge tone="ok">Ready</Badge>
          )}
        </span>
        <Button size="sm" variant="ghost" onClick={props.onOpen} aria-expanded={props.open} aria-controls={`${id}-panel`}>
          {props.open ? "Close" : "Edit"}
        </Button>
      </div>

      {props.checked && errors.length > 0 && !props.open && (
        <ul className="-mt-1 px-3.5 pb-3 pl-[52px] text-[13px] text-bad">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {props.open && (
        <div id={`${id}-panel`} className="space-y-3 border-t border-line px-3.5 py-3.5">
          {info.capabilities.formats && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${info.name} format`}>
              {info.capabilities.formats.map((f) => {
                const active = String(props.options.igFormat ?? "FEED") === f.id;
                return (
                  <button
                    key={f.id}
                    role="radio"
                    aria-checked={active}
                    title={f.description}
                    onClick={() => props.onOptions({ igFormat: f.id })}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[13px]",
                      active ? "border-signal bg-signal-soft text-signal" : "border-line-strong text-slate hover:text-ink",
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={`${id}-text`}>{info.name} version</Label>
              {customized && (
                <button onClick={props.onReset} className="flex items-center gap-1 text-[13px] text-slate hover:text-ink">
                  <RotateCcw className="size-3.5" /> Use original text
                </button>
              )}
            </div>
            <Textarea id={`${id}-text`} className="mt-1 min-h-28" value={props.text} onChange={(e) => props.onText(e.target.value)} />
            {props.version?.notes && <p className="mt-1 text-[13px] text-muted">AI note: {props.version.notes}</p>}
          </div>
          {errors.length > 0 && (
            <ul className="space-y-0.5 text-[13px] text-bad">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {v && v.warnings.length > 0 && (
            <ul className="space-y-0.5 text-[13px] text-warn">
              {v.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <details className="text-[13px] text-slate">
            <summary className="cursor-pointer">What {info.name} supports</summary>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              {info.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </li>
  );
}

export function DeleteDraftButton({ postId }: { postId: string }) {
  const router = useRouter();
  return (
    <Button
      variant="danger"
      size="sm"
      onClick={async () => {
        if (!confirm("Delete this post? This can't be undone.")) return;
        try {
          await api(`/api/posts/${postId}`, { method: "DELETE" });
          toast.success("Deleted");
          router.push("/drafts");
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      <Trash2 /> Delete
    </Button>
  );
}

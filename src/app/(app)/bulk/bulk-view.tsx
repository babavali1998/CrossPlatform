"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { api, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Badge, Panel } from "@/components/ui/misc";

type PreviewRow = { row: number; text: string; accounts: string[]; scheduledAt: string | null; mediaUrl: string | null; errors: string[] };
type Result = { row: number; ok: boolean; postId?: string; error?: string };

const SAMPLE = `text,accounts,scheduled_at,media_url,ig_format
"New screen protectors just landed. Come by the store this week!",threads;x;linkedin,2026-12-01 10:00,,
"Holiday hours: open 9 to 7 every day until Dec 24.",all,2026-12-05 09:30,,
"Quick tip: back up your phone before any repair.",x,,,`;

export function BulkView({ timezone }: { timezone: string }) {
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);

  const previewCsv = async () => {
    setBusy(true);
    setResults(null);
    try {
      const r = await api<{ rows: PreviewRow[] }>("/api/posts/bulk", { method: "POST", json: { csv, preview: true } });
      setRows(r.rows);
      if (!r.rows.length) toast.error("No rows found. Check the header row.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async () => {
    setBusy(true);
    try {
      const r = await api<{ results: Result[] }>("/api/posts/bulk", { method: "POST", json: { csv, preview: false } });
      setResults(r.results);
      const ok = r.results.filter((x) => x.ok).length;
      toast.success(`Imported ${ok} of ${r.results.length} posts`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const valid = rows?.filter((r) => !r.errors.length).length ?? 0;

  return (
    <div className="space-y-5">
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold">CSV</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCsv(SAMPLE)}>
              Insert example
            </Button>
            <Button size="sm" asChild>
              <label className="cursor-pointer">
                <FileUp /> Choose file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setCsv(await f.text());
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
          </div>
        </div>
        <Textarea
          className="mt-3 min-h-44 font-mono text-[13px]"
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setRows(null);
            setResults(null);
          }}
          placeholder="Paste CSV here, including the header row"
          aria-label="CSV content"
        />
        <details className="mt-3 text-[13px] text-slate">
          <summary className="cursor-pointer">Column reference</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
            <dt className="font-medium text-ink">text</dt>
            <dd>Post text. The same text goes to every account in the row.</dd>
            <dt className="font-medium text-ink">accounts</dt>
            <dd>
              <code>all</code>, platform names (<code>instagram;x</code>) or usernames (<code>@mystore</code>), separated by semicolons.
            </dd>
            <dt className="font-medium text-ink">scheduled_at</dt>
            <dd>
              <code>2026-12-01 10:00</code> in your timezone ({timezone}), or ISO 8601 with an offset. Leave empty to save a draft.
            </dd>
            <dt className="font-medium text-ink">media_url</dt>
            <dd>Optional https link to one image or video. It’s downloaded and stored with the post.</dd>
            <dt className="font-medium text-ink">ig_format</dt>
            <dd>Optional FEED, REEL or STORY for Instagram.</dd>
          </dl>
        </details>
        <div className="mt-4 flex gap-2">
          <Button onClick={previewCsv} disabled={!csv.trim() || busy}>
            {busy && !rows ? <Loader2 className="animate-spin" /> : null}
            Check rows
          </Button>
          {rows && valid > 0 && !results && (
            <Button variant="primary" onClick={importCsv} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Import {valid} {valid === 1 ? "post" : "posts"}
            </Button>
          )}
        </div>
      </Panel>

      {rows && (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Row</th>
                <th className="px-4 py-2 font-medium">Text</th>
                <th className="px-4 py-2 font-medium">Accounts</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const res = results?.find((x) => x.row === r.row);
                return (
                  <tr key={r.row} className={cn(r.errors.length && "bg-bad-soft/40")}>
                    <td className="px-4 py-2.5 tabular-nums text-muted">{r.row}</td>
                    <td className="max-w-xs truncate px-4 py-2.5" title={r.text}>
                      {r.text}
                    </td>
                    <td className="px-4 py-2.5 text-slate">{r.accounts.join(", ") || "None"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate">
                      {r.scheduledAt ? new Date(r.scheduledAt).toLocaleString() : "Draft"}
                    </td>
                    <td className="px-4 py-2.5">
                      {res ? (
                        res.ok ? (
                          <Link href={`/compose?post=${res.postId}`}>
                            <Badge tone="ok">Imported</Badge>
                          </Link>
                        ) : (
                          <span className="text-bad">{res.error}</span>
                        )
                      ) : r.errors.length ? (
                        <span className="text-bad">{r.errors.join("; ")}</span>
                      ) : (
                        <Badge tone="signal">Ready</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

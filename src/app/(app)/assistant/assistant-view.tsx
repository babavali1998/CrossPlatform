"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/ui/misc";

const QUICK = [
  "Make it shorter",
  "Write 3 different opening lines",
  "Suggest 8 relevant hashtags",
  "Make it sound more casual",
  "Turn it into a question that invites replies",
  "Fix grammar and spelling only",
];

export function AssistantView({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [platform, setPlatform] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (ins: string) => {
    if (!ins.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ text: string }>("/api/ai/assist", {
        method: "POST",
        json: { instruction: ins, text, platform: platform || undefined },
      });
      setResult(r.text);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <Panel className="p-6 text-slate">
        AI features are off. Add <code>OPENAI_API_KEY</code> to the server environment and restart to use the assistant.
      </Panel>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel className="space-y-4 p-5">
        <div>
          <Label htmlFor="src">Your text</Label>
          <Textarea id="src" className="mt-1 min-h-40" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a draft, or leave empty to brainstorm from scratch" />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <div>
            <Label htmlFor="ins">What should it do?</Label>
            <Input
              id="ins"
              className="mt-1"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run(instruction)}
              placeholder="e.g. announce our new store hours"
            />
          </div>
          <div>
            <Label htmlFor="pf">For</Label>
            <Select id="pf" className="mt-1" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">Any platform</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="THREADS">Threads</option>
              <option value="X">X</option>
              <option value="LINKEDIN">LinkedIn</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => run(q)} disabled={busy} className="rounded-full border border-line-strong px-3 py-1 text-[13px] text-slate hover:border-signal hover:text-signal disabled:opacity-50">
              {q}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => run(instruction)} disabled={busy || !instruction.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Run
        </Button>
      </Panel>

      <Panel className="flex flex-col p-5">
        <h2 className="text-[15px] font-semibold">Result</h2>
        {result ? (
          <>
            <p className="mt-2 flex-1 whitespace-pre-wrap text-[15px]">{result}</p>
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(result);
                  toast.success("Copied");
                }}
              >
                <Copy /> Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setText(result)}>
                Use as new input
              </Button>
              <Button size="sm" variant="ghost" onClick={() => router.push("/compose")}>
                Open composer
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-slate">Results show up here.</p>
        )}
      </Panel>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Plus, RefreshCw, Unplug } from "lucide-react";
import type { Platform } from "@/generated/prisma/browser";
import type { SerializedAccount } from "@/lib/accounts";
import { PlatformIcon } from "@/components/platform-icon";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/misc";
import { Input, Label } from "@/components/ui/field";
import { api, cn } from "@/lib/utils";

type PlatformRow = {
  id: Platform;
  name: string;
  status: "available" | "planned";
  configured: boolean;
  envKeys: string[];
  requirements: string[];
  limitations: string[];
  redirectUri: string;
};

export function AccountsView({
  accounts: initial,
  platforms,
  flash,
}: {
  accounts: SerializedAccount[];
  platforms: PlatformRow[];
  flash: { connected?: string; error?: string };
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(initial);

  useEffect(() => {
    if (flash.connected) {
      const a = initial.find((x) => x.id === flash.connected);
      toast.success(a ? `Connected @${a.username}` : "Account connected");
    }
    if (flash.error) toast.error(flash.error, { duration: 12_000 });
    if (flash.connected || flash.error) router.replace("/accounts");
  }, [flash.connected, flash.error, initial, router]);

  const available = platforms.filter((p) => p.status === "available");
  const planned = platforms.filter((p) => p.status === "planned");

  return (
    <div className="space-y-4">
      {available.map((p) => (
        <PlatformSection
          key={p.id}
          platform={p}
          accounts={accounts.filter((a) => a.platform === p.id)}
          onChange={(a) => setAccounts((all) => all.map((x) => (x.id === a.id ? a : x)))}
          onRemove={(id) => setAccounts((all) => all.filter((x) => x.id !== id))}
        />
      ))}

      <div className="pt-6">
        <h2 className="text-lg font-semibold">Coming later</h2>
        <p className="mt-0.5 text-sm text-slate">Listed so you know what’s planned. These can’t be connected yet.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {planned.map((p) => (
            <li key={p.id} className="flex items-start gap-3 rounded-xl border border-line px-4 py-3 opacity-80">
              <PlatformIcon platform={p.id} className="size-7 grayscale" />
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-[13px] text-slate">{p.requirements[0]}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PlatformSection({
  platform: p,
  accounts,
  onChange,
  onRemove,
}: {
  platform: PlatformRow;
  accounts: SerializedAccount[];
  onChange: (a: SerializedAccount) => void;
  onRemove: (id: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <PlatformIcon platform={p.id} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">{p.name}</h2>
          <p className="text-[13px] text-slate">
            {accounts.length ? `${accounts.length} connected` : p.configured ? "Not connected" : "Server credentials missing"}
          </p>
        </div>
        <button
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-slate hover:text-ink"
          onClick={() => setShowDetails(!showDetails)}
          aria-expanded={showDetails}
        >
          Requirements <ChevronDown className={cn("size-4 transition-transform", showDetails && "rotate-180")} />
        </button>
        {p.configured ? (
          <Button asChild variant={accounts.length ? "secondary" : "primary"} size="sm">
            <a href={`/api/connect/${p.id.toLowerCase()}`}>
              <Plus /> {accounts.length ? "Add another" : "Connect"}
            </a>
          </Button>
        ) : (
          <Badge tone="warn" title={`Set ${p.envKeys.join(", ")}`}>
            Set {p.envKeys.join(", ")}
          </Badge>
        )}
      </div>

      {showDetails && (
        <div className="grid gap-6 border-t border-line bg-paper/60 px-5 py-4 text-[13px] md:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold">What you need</h3>
            <ul className="list-disc space-y-1 pl-4 text-slate">
              {p.requirements.map((r) => (
                <li key={r}>{r}</li>
              ))}
              <li>
                Redirect URI to register: <code className="break-all rounded bg-line/70 px-1">{p.redirectUri}</code>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold">Limits</h3>
            <ul className="list-disc space-y-1 pl-4 text-slate">
              {p.limitations.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {accounts.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} onChange={onChange} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AccountRow({
  account: a,
  onChange,
  onRemove,
}: {
  account: SerializedAccount;
  onChange: (a: SerializedAccount) => void;
  onRemove: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"check" | "remove" | null>(null);
  const [maxChars, setMaxChars] = useState(String(a.settings.maxChars ?? ""));

  const check = async () => {
    setBusy("check");
    try {
      const { account } = await api<{ account: SerializedAccount }>(`/api/accounts/${a.id}`, { method: "POST" });
      onChange(account);
      if (account.status === "ACTIVE") toast.success(`@${account.username} is working`);
      else toast.error(account.statusMessage || "This account needs to be reconnected");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Disconnect @${a.username}? Scheduled posts for this account will be canceled. Published posts stay on ${a.platform.toLowerCase()}.`)) return;
    setBusy("remove");
    try {
      await api(`/api/accounts/${a.id}`, { method: "DELETE" });
      onRemove(a.id);
      toast.success(`Disconnected @${a.username}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveLimit = async () => {
    const n = maxChars.trim() ? Number(maxChars) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1)) return toast.error("Enter a whole number");
    try {
      const { account } = await api<{ account: SerializedAccount }>(`/api/accounts/${a.id}`, {
        method: "PATCH",
        json: { settings: { maxChars: n } },
      });
      onChange(account);
      toast.success(n ? `Character limit set to ${n}` : "Using the default limit");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const expires = a.tokenExpiresAt ? new Date(a.tokenExpiresAt) : null;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5">
      {a.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.avatarUrl} alt="" className="size-10 rounded-full border border-line object-cover" />
      ) : (
        <span className="grid size-10 place-items-center rounded-full bg-line font-semibold text-slate">
          {a.username.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{a.displayName || a.username}</p>
        <p className="truncate text-[13px] text-slate">
          @{a.username}
          {expires && a.status === "ACTIVE" && <span className="text-muted"> (token renews automatically, current one valid until {expires.toLocaleDateString()})</span>}
        </p>
        {a.status !== "ACTIVE" && <p className="mt-1 text-[13px] text-bad">{a.statusMessage || "Needs to be reconnected"}</p>}
      </div>

      {a.platform === "X" && (
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor={`max-${a.id}`}>Character limit</Label>
            <Input
              id={`max-${a.id}`}
              className="h-8 w-28"
              inputMode="numeric"
              placeholder="280"
              value={maxChars}
              onChange={(e) => setMaxChars(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={saveLimit} title="X Premium accounts can post up to 25,000 characters">
            Save
          </Button>
        </div>
      )}

      {a.status === "ACTIVE" ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">Reconnect needed</Badge>}
      <div className="flex gap-1.5">
        {a.status !== "ACTIVE" ? (
          <Button asChild size="sm" variant="primary">
            <a href={`/api/connect/${a.platform.toLowerCase()}`}>Reconnect</a>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={check} disabled={!!busy}>
            <RefreshCw className={cn(busy === "check" && "animate-spin")} /> Check
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={remove} disabled={!!busy} aria-label={`Disconnect @${a.username}`}>
          <Unplug /> Disconnect
        </Button>
      </div>
    </li>
  );
}

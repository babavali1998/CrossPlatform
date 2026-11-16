import { Badge } from "@/components/ui/misc";

const POST: Record<string, { label: string; tone: "neutral" | "signal" | "ok" | "warn" | "bad" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "signal" },
  QUEUED: { label: "Queued", tone: "signal" },
  PUBLISHING: { label: "Publishing", tone: "signal" },
  PUBLISHED: { label: "Published", tone: "ok" },
  PARTIAL: { label: "Partly published", tone: "warn" },
  FAILED: { label: "Failed", tone: "bad" },
  CANCELED: { label: "Canceled", tone: "neutral" },
};

const TARGET: Record<string, { label: string; tone: "neutral" | "signal" | "ok" | "warn" | "bad" }> = {
  PENDING: { label: "Waiting", tone: "neutral" },
  QUEUED: { label: "Queued", tone: "signal" },
  PUBLISHING: { label: "Publishing", tone: "signal" },
  PUBLISHED: { label: "Published", tone: "ok" },
  FAILED: { label: "Failed", tone: "bad" },
  CANCELED: { label: "Canceled", tone: "neutral" },
};

export function PostStatusBadge({ status }: { status: string }) {
  const s = POST[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function TargetStatusBadge({ status }: { status: string }) {
  const s = TARGET[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

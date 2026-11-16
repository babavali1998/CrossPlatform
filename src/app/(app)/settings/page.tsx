import { signOut } from "@/auth";
import { requireUser } from "@/lib/session";
import { PLATFORM_ORDER, PLATFORMS } from "@/lib/platforms/catalog";
import { isConfigured } from "@/lib/platforms/registry";
import { Badge, PageHeader, Panel } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const services = [
    { name: "AI (OpenAI)", ok: !!process.env.OPENAI_API_KEY, note: process.env.OPENAI_MODEL || "gpt-4.1-mini" },
    { name: "Public media URL", ok: !!process.env.S3_PUBLIC_BASE_URL, note: process.env.S3_PUBLIC_BASE_URL ? "Set" : "Using presigned URLs" },
    { name: "X analytics", ok: process.env.X_ENABLE_METRICS === "true", note: "Billed by X when on" },
  ];

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="text-[17px] font-semibold">Profile</h2>
          <SettingsForm name={user.name ?? ""} timezone={user.timezone} email={user.email ?? ""} />
          <form
            className="mt-6 border-t border-line pt-4"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button variant="danger" size="sm">
              Sign out
            </Button>
          </form>
        </Panel>

        <Panel className="p-5">
          <h2 className="text-[17px] font-semibold">Server configuration</h2>
          <p className="mt-0.5 text-[13px] text-slate">Read-only. Change these in the server’s environment variables.</p>
          <ul className="mt-4 divide-y divide-line text-sm">
            {PLATFORM_ORDER.filter((p) => PLATFORMS[p].status === "available").map((p) => (
              <li key={p} className="flex items-center justify-between py-2.5">
                <span>{PLATFORMS[p].name}</span>
                {isConfigured(p) ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Missing {PLATFORMS[p].envKeys.join(", ")}</Badge>}
              </li>
            ))}
            {services.map((s) => (
              <li key={s.name} className="flex items-center justify-between gap-3 py-2.5">
                <span>{s.name}</span>
                <Badge tone={s.ok ? "ok" : "neutral"}>{s.note}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

import { redirect } from "next/navigation";
import { auth, availableLoginProviders, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { PlatformIcon } from "@/components/platform-icon";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user?.id) redirect("/compose");
  const { error } = await searchParams;
  const p = availableLoginProviders;
  const none = !p.google && !p.github && !p.dev;

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex gap-1.5" aria-hidden>
          {(["INSTAGRAM", "THREADS", "X", "LINKEDIN"] as const).map((pl) => (
            <PlatformIcon key={pl} platform={pl} className="size-7" />
          ))}
        </div>
        <h1 className="text-[28px] font-semibold">Sign in to CrossPlatform</h1>
        <p className="mt-1 text-slate">Write a post once and send it to every account you connect.</p>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {error === "AccessDenied" ? "This email isn't on the allowed list." : "Sign-in failed. Try again."}
          </p>
        )}

        <div className="mt-6 space-y-2.5">
          {p.google && (
            <form action={async () => { "use server"; await signIn("google", { redirectTo: "/compose" }); }}>
              <Button className="w-full" size="lg">Continue with Google</Button>
            </form>
          )}
          {p.github && (
            <form action={async () => { "use server"; await signIn("github", { redirectTo: "/compose" }); }}>
              <Button className="w-full" size="lg">Continue with GitHub</Button>
            </form>
          )}
          {p.dev && (
            <form
              className="space-y-2.5 rounded-xl border border-dashed border-warn/50 p-4"
              action={async (fd: FormData) => {
                "use server";
                await signIn("dev", { email: String(fd.get("email")), redirectTo: "/compose" });
              }}
            >
              <p className="text-[13px] text-warn">Local development login. Disabled in production.</p>
              <Input name="email" type="email" required placeholder="you@example.com" aria-label="Email" />
              <Button variant="primary" className="w-full">Sign in</Button>
            </form>
          )}
          {none && (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              No sign-in method is configured. Set AUTH_GOOGLE_ID/SECRET or AUTH_GITHUB_ID/SECRET, or
              ALLOW_DEV_LOGIN=true for local development.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

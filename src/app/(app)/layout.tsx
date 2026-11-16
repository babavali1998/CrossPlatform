import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const counts = await db.post.groupBy({
    by: ["status"],
    where: { userId: user.id, status: { in: ["DRAFT", "SCHEDULED"] } },
    _count: true,
  });
  const reconnect = await db.socialAccount.count({ where: { userId: user.id, status: "NEEDS_RECONNECT" } });
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <Sidebar
        user={{ name: user.name, email: user.email, image: user.image }}
        badges={{ drafts: count("DRAFT"), scheduled: count("SCHEDULED"), accounts: reconnect }}
      />
      <main className="min-w-0 px-4 pb-16 pt-6 md:px-10 md:pt-10">
        <div className="mx-auto max-w-[1180px]">{children}</div>
      </main>
    </div>
  );
}

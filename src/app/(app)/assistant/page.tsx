import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/lib/session";
import { AssistantView } from "./assistant-view";

export const metadata = { title: "AI assistant" };

export default async function AssistantPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Rewrite, shorten, or brainstorm a post. Nothing here is published; copy what you like into the composer."
      />
      <AssistantView enabled={!!process.env.OPENAI_API_KEY} />
    </>
  );
}

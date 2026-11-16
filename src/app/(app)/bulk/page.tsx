import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/lib/session";
import { BulkView } from "./bulk-view";

export const metadata = { title: "Bulk upload" };

export default async function BulkPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title="Bulk upload"
        description="Import many posts from a CSV. Rows with a date are scheduled; rows without one become drafts."
      />
      <BulkView timezone={user.timezone} />
    </>
  );
}

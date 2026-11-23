import { notFound } from "next/navigation";
import DiscoveryScene from "@/components/scene/DiscoveryScene";
import { previewBrief } from "@/lib/preview-brief";
import { requireMembership } from "@/lib/server/briefs";

export const dynamic = "force-dynamic";

export default async function Preview() {
  if (process.env.NODE_ENV !== "development") {
    if (process.env.OUTLANDISH_ENABLE_PREVIEW !== "1") notFound();
    const access = await requireMembership();
    if (!("supabase" in access)) notFound();
  }
  return <DiscoveryScene brief={previewBrief} accountAction={<a href="/">Back to workspace</a>} />;
}

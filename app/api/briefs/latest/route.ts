import { briefResponse, readLatestBrief } from "../../../../lib/server/briefs";

export const dynamic = "force-dynamic";

export async function GET() {
  return briefResponse(await readLatestBrief());
}

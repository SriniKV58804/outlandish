import { readLatestSceneBrief } from "../../../../lib/publication/read";
import { briefResponse } from "../../../../lib/server/briefs";

export const dynamic = "force-dynamic";

export async function GET() {
  return briefResponse(await readLatestSceneBrief());
}

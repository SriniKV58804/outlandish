import { briefResponse, readOpportunity } from "../../../../lib/server/briefs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return briefResponse(await readOpportunity(id));
}

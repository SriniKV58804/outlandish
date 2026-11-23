import "server-only";
import { timingSafeEqual } from "node:crypto";
import { advanceDiscovery } from "../../../../lib/collection/worker.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const current = Buffer.from(request.headers.get("Authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return current.length === expected.length && timingSafeEqual(current, expected);
}
async function handle(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (request.method === "GET" && process.env.ORIANE_CRON_ENABLED !== "true") {
    return Response.json({ error: "Scheduled collection is disabled." }, { status: 409, headers });
  }
  try {
    const result = await advanceDiscovery();
    return Response.json(result, { headers, status: result.status === "open" ? 202 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collection could not advance.";
    return Response.json({ error: message }, { headers, status: 503 });
  }
}
export const GET = handle;
export const POST = handle;

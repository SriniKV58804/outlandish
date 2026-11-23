import { type NextRequest, NextResponse } from "next/server";
import { createRequestClient } from "../../../lib/server/supabase";
import { approvedReturnPath, loginPath } from "../../../lib/server/redirects";

export const dynamic = "force-dynamic";

function redirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const next = approvedReturnPath(request.nextUrl.searchParams.get("next"));

  if (!tokenHash || (type !== "invite" && type !== "email" && type !== "magiclink")) {
    return redirect(request, loginPath(next, "invalid"));
  }

  const supabase = await createRequestClient();
  if (!supabase) return redirect(request, loginPath(next, "unavailable"));
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  return redirect(request, error ? loginPath(next, "invalid") : next);
}

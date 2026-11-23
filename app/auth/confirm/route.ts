import { type NextRequest, NextResponse } from "next/server";
import { createRequestClient } from "../../../lib/server/supabase";
import { approvedReturnPath, loginPath } from "../../../lib/server/redirects";

export const dynamic = "force-dynamic";

function redirect(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set("outlandish-return", "", { path: "/auth/confirm", maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const code = request.nextUrl.searchParams.get("code");
  const next = approvedReturnPath(request.nextUrl.searchParams.get("next") ?? request.cookies.get("outlandish-return")?.value);

  const validHash = tokenHash && (type === "invite" || type === "email" || type === "magiclink");
  if (!code && !validHash) {
    return redirect(request, loginPath(next, "invalid"));
  }

  const supabase = await createRequestClient();
  if (!supabase) return redirect(request, loginPath(next, "unavailable"));
  const { error } = validHash
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : await supabase.auth.exchangeCodeForSession(code!);
  return redirect(request, error ? loginPath(next, "invalid") : next);
}

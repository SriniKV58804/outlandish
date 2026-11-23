import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");

  if (!url || !key || !request.cookies.getAll().some(({ name }) => name.startsWith("sb-"))) {
    return response;
  }

  let refreshedResponse = response;
  const supabase = createServerClient(url, key, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (updates, headers) => {
        for (const { name, value } of updates) {
          request.cookies.set(name, value);
        }
        const refreshHeaders = new Headers(refreshedResponse.headers);
        for (const [name, value] of Object.entries(headers)) {
          refreshHeaders.set(name, value);
        }
        refreshedResponse = NextResponse.next({ request, headers: refreshHeaders });
        for (const { name, value, options } of updates) {
          refreshedResponse.cookies.set(name, value, options);
        }
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });

  // Route and database access checks run independently of session refresh.
  await supabase.auth.getClaims();
  return refreshedResponse;
}

export const config = {
  matcher: ["/", "/api/:path*", "/login", "/opportunities/:path*"],
};

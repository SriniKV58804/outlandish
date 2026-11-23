export function approvedReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/?") || value.length > 700) return "/";
  const params = new URLSearchParams(value.slice(2));
  const topic = params.get("opportunity");
  const clip = params.get("clip");
  if (!topic || !/^[\w-]{1,160}$/.test(topic)) return "/";
  if (clip !== null && !/^[A-Za-z0-9_:.-]{1,180}$/.test(clip)) return "/";
  const safe = new URLSearchParams({ opportunity: topic });
  if (clip) safe.set("clip", clip);
  return "/?" + safe.toString();
}

export function loginPath(next: string, status?: string): string {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (next !== "/") query.set("next", next);
  return query.size ? `/login?${query.toString()}` : "/login";
}

export function signInCallback(requestOrigin: string | null, siteUrl: string | undefined,
  productionHost: string | undefined, development: boolean): string | null {
  try {
    if (!requestOrigin) return null;
    const origin = new URL(requestOrigin);
    const local = development && origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    const hosted = origin.protocol === "https:" && (
      (productionHost && origin.origin === `https://${productionHost}`) || (siteUrl && origin.origin === new URL(siteUrl).origin)
    );
    if (!local && !hosted) return null;
    return new URL("/auth/confirm", origin.origin).href;
  } catch {
    return null;
  }
}

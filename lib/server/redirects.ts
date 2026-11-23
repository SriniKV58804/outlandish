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

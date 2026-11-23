export function approvedReturnPath(value: unknown): string {
  return typeof value === "string" && /^\/\?opportunity=[A-Za-z0-9_-]{1,160}$/.test(value)
    ? value
    : "/";
}

export function loginPath(next: string, status?: string): string {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (next !== "/") query.set("next", next);
  return query.size ? `/login?${query.toString()}` : "/login";
}

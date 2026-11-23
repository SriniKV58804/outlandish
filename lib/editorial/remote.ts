export async function rpc<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
  const endpoint = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!endpoint || !key) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in the operator environment.");
  }

  const origin = new URL(endpoint);
  const allowLoopback = origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((!allowLoopback && origin.protocol !== "https:") || origin.username || origin.password) {
    throw new Error("Supabase operator URL must use HTTPS or local HTTP.");
  }
  const headers = {
    "Content-Type": "application/json",
    apikey: key,
    ...(!key.startsWith("sb_secret_") && { Authorization: `Bearer ${key}` }),
  };

  let response;
  try {
    response = await fetch(new URL(`/rest/v1/rpc/${functionName}`, origin), {
      method: "POST", headers, body: JSON.stringify(args),
      redirect: "error", signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`Supabase operation ${functionName} could not connect. Check the project URL and network.`);
  }
  if (!response.ok) {
    throw new Error(`Supabase operation ${functionName} failed with HTTP ${response.status}. Check migrations and operator credentials.`);
  }
  return await response.json() as T;
}

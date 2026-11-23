"use server";

import { redirect } from "next/navigation";
import { createRequestClient } from "../../lib/server/supabase";

export async function signOut() {
  const supabase = await createRequestClient();
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error && error.name !== "AuthSessionMissingError") redirect("/login?status=signout");
  }
  redirect("/login");
}

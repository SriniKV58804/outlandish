"use server";

import { redirect } from "next/navigation";
import { createRequestClient } from "../../lib/server/supabase";
import { approvedReturnPath } from "../../lib/server/redirects";

type LoginState = { step: "email" | "code"; email?: string; error?: string };

export async function requestCode(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    return { step: "email", error: "Enter a valid email address." };
  }

  const supabase = await createRequestClient();
  if (!supabase) return { step: "email", error: "Sign-in is unavailable right now." };

  // Give the same response for unknown, disabled and existing addresses.
  await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  return { step: "code", email };
}

export async function verifyCode(state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("code") ?? "").trim();
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    return { step: "email", error: "Enter a valid email address." };
  }
  if (!/^\d{6,10}$/.test(token)) {
    return { ...state, step: "code", email, error: "Enter the code from your email." };
  }

  const supabase = await createRequestClient();
  if (!supabase) return { ...state, step: "code", email, error: "Sign-in is unavailable right now." };
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { ...state, step: "code", email, error: "That code could not be verified. Request a new one and try again." };

  redirect(approvedReturnPath(formData.get("next")));
}

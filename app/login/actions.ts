"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createRequestClient } from "../../lib/server/supabase";
import { approvedReturnPath, signInCallback } from "../../lib/server/redirects";

type LoginState = { step: "email" | "code"; email?: string; error?: string };

export async function requestCode(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
    return { step: "email", error: "Enter a valid email address." };
  }

  const supabase = await createRequestClient();
  if (!supabase) return { step: "email", error: "Sign-in is unavailable right now." };

  const origin = (await headers()).get("origin");
  const callback = signInCallback(origin, process.env.OUTLANDISH_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.NODE_ENV === "development");
  if (!callback) return { step: "email", error: "Open the production workspace URL to sign in." };
  const { error } = await supabase.auth.signInWithOtp({
    email, options: { shouldCreateUser: false, emailRedirectTo: callback },
  });
  if (error?.status === 429) return { step: "email", error: "Too many requests. Try again in a few minutes." };
  if (error && (!error.status || error.status >= 500)) return { step: "email", error: "Email sign-in is temporarily unavailable. Try again later." };
  // Keep the same screen for invited, unknown and delivery-restricted addresses.
  (await cookies()).set("outlandish-return", approvedReturnPath(formData.get("next")), {
    path: "/auth/confirm", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 3600,
  });
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

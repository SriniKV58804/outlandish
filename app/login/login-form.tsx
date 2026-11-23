"use client";

import { useActionState } from "react";
import { requestCode, verifyCode } from "./actions";

export default function LoginForm({ next, retryPath }: { next: string; retryPath: string }) {
  const [request, send, sending] = useActionState(requestCode, { step: "email" });
  const [verification, verify, verifying] = useActionState(verifyCode, { step: "code" });
  const email = request.email;

  if (request.step === "code" && email) {
    return (
      <form action={verify} className="login-form">
        <p>If this email has been invited, a sign-in code is on its way.</p>
        <input name="email" type="hidden" value={email} />
        <input name="next" type="hidden" value={next} />
        <label htmlFor="code">Sign-in code</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        {verification.error && <p role="alert">{verification.error}</p>}
        <button disabled={verifying}>{verifying ? "Checking…" : "Sign in"}</button>
        <a href={retryPath}>Use a different email or request a new code</a>
      </form>
    );
  }

  return (
    <form action={send} className="login-form">
      <label htmlFor="email">Invited email address</label>
      <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
      {request.error && <p role="alert">{request.error}</p>}
      <button disabled={sending}>{sending ? "Requesting…" : "Send sign-in code"}</button>
    </form>
  );
}

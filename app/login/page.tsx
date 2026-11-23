import type { Metadata } from "next";
import { supabaseConfig } from "../../lib/server/supabase";
import { approvedReturnPath, loginPath } from "../../lib/server/redirects";
import LoginForm from "./login-form";
import { signOut } from "../auth/actions";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in | Outlandish", robots: "noindex, nofollow" };

const messages: Record<string, string> = {
  invalid: "That sign-in link has expired or already been used. Request a new code.",
  unavailable: "Sign-in is unavailable right now.",
  signout: "Sign-out could not finish. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; next?: string | string[] }>;
}) {
  const { status, next } = await searchParams;
  const message = typeof status === "string" && Object.hasOwn(messages, status) ? messages[status] : null;
  const returnPath = approvedReturnPath(next);
  const configured = supabaseConfig() !== null;

  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-labelledby="login-title">
        <p className={styles.brand}>Outlandish</p>
        <h1 id="login-title">Open your discovery workspace</h1>
        {message && <p role="alert">{message}</p>}
        {status === "signout" && configured ? (
          <form action={signOut} className="login-form"><button>Try sign-out again</button></form>
        ) : configured ? <LoginForm next={returnPath} retryPath={loginPath(returnPath)} /> : (
          <p>Sign-in is unavailable right now.</p>
        )}
      </section>
    </main>
  );
}

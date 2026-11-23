import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import DiscoveryScene from "@/components/scene/DiscoveryScene";
import { readBriefForOpportunity, readLatestSceneBrief } from "@/lib/publication/read";
import { loginPath } from "@/lib/server/redirects";
import styles from "./login/login.module.css";

export const dynamic = "force-dynamic";

function SignOut() {
  return <form action={signOut}><button type="submit">Sign out</button></form>;
}

export default async function Home({ searchParams }: {
  searchParams: Promise<{ opportunity?: string | string[]; clip?: string | string[] }>;
}) {
  const { opportunity, clip } = await searchParams;
  if (opportunity !== undefined && (typeof opportunity !== "string" || !/^[\w-]{1,160}$/.test(opportunity))) notFound();

  if (clip !== undefined && (!opportunity || typeof clip !== "string" || !/^[A-Za-z0-9_:.-]{1,180}$/.test(clip))) notFound();
  const query = new URLSearchParams();
  if (opportunity) query.set("opportunity", opportunity);
  if (clip) query.set("clip", clip);
  const returnPath = query.size ? "/?" + query.toString() : "/";
  const result = opportunity ? await readBriefForOpportunity(opportunity) : await readLatestSceneBrief();
  if (result.status === 401) redirect(loginPath(returnPath));
  if (result.status === 404) notFound();
  if (result.status === 200) {
    if (clip && !result.data.opportunities.find(item => item.id === opportunity)?.clips.some(item => item.id === clip)) notFound();
    return <DiscoveryScene brief={result.data} initialId={opportunity} initialClipId={clip} accountAction={<SignOut />}
      showPreviewLink={process.env.NODE_ENV === "development" || process.env.OUTLANDISH_ENABLE_PREVIEW === "1"} />;
  }
  const denied = result.status === 403;
  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-labelledby="access-heading">
        <p className={styles.brand}>Outlandish</p>
        <h1 id="access-heading">{denied ? "Invitation required" : "Discovery is unavailable"}</h1>
        <p>{denied ? "This account needs an active invitation to view the weekly collection." : "The private collection could not be loaded."}</p>
        {denied ? <SignOut /> : <a href={returnPath}>Try again</a>}
        {process.env.NODE_ENV === "development" && <p><a href="/preview">Open the local interaction preview</a></p>}
      </section>
    </main>
  );
}

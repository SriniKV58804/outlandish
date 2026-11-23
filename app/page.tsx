import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import WeeklyBrief from "@/components/WeeklyBrief";
import { readLatestBrief } from "@/lib/server/briefs";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  opportunity?: string | string[];
  fixture?: string | string[];
}>;

function SignOut() {
  return <form action={signOut}><button type="submit">Sign out</button></form>;
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  if (process.env.NODE_ENV === "development" && process.env.OUTLANDISH_FIXTURE === "1") {
    const { getFixture } = await import("@/lib/dev-fixtures");
    return <WeeklyBrief {...getFixture(params.fixture)} />;
  }

  const requested = typeof params.opportunity === "string" && params.opportunity.length <= 160
    ? "/?opportunity=" + encodeURIComponent(params.opportunity)
    : "/";
  const result = await readLatestBrief();

  if (result.status === 200) return <WeeklyBrief brief={result.data} accountAction={<SignOut />} />;
  if (result.status === 401) redirect("/login?next=" + encodeURIComponent(requested));

  const forbidden = result.status === 403;
  return (
    <main className="page-status">
      <div role="status">
        <h1>{forbidden ? "Invitation required" : "Weekly brief unavailable"}</h1>
        <p>
          {forbidden
            ? "The account you signed in with needs an active invitation."
            : "The brief couldn’t load. Try again in a moment."}
        </p>
        {forbidden && <SignOut />}
        {!forbidden && <a href={requested}>Try again</a>}
      </div>
    </main>
  );
}

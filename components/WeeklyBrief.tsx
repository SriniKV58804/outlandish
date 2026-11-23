"use client";

import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type Comparison,
  type LatestBrief,
  type OpportunityDetail,
  type OpportunitySummary,
  type Platform,
  type Preview,
  opportunityDetailSchema,
} from "@/lib/contracts";
import styles from "./WeeklyBrief.module.css";

type LoadedDetail =
  | { kind: "ready"; detail: OpportunityDetail }
  | { kind: "expired" | "forbidden" | "missing" | "error" };

const selectionEvent = "outlandish:selection";
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const observationFormat = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Los_Angeles",
});
const numberFormat = new Intl.NumberFormat("en-US");

const platformLabel: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram" };
const statusLabel = { rising: "Rising", comparable: "Comparable", observed: "Observed this week" };
const availabilityLabel = {
  available: "Comments available",
  "checked-empty": "Checked for comments · none observed",
  partial: "Comments partially available",
  unavailable: "Comments unavailable",
};

function subscribeToSelection(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(selectionEvent, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(selectionEvent, listener);
  };
}

function readSelection() {
  return new URLSearchParams(window.location.search).get("opportunity") || null;
}

function updateSelection(id: string | null) {
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set("opportunity", id);
    window.history.pushState({ outlandishFromOverview: true }, "", url);
  } else if (window.history.state?.outlandishFromOverview) {
    window.history.back();
    return;
  } else {
    url.searchParams.delete("opportunity");
    window.history.replaceState({ outlandishFromOverview: false }, "", url);
  }
  window.dispatchEvent(new Event(selectionEvent));
}

function calendarParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month: months[month - 1], day };
}

function calendarLabel(value: string) {
  const { year, month, day } = calendarParts(value);
  return `${month} ${day}, ${year}`;
}

function observationLabel(value: string) {
  const parts = observationFormat.formatToParts(new Date(value));
  const month = parts.find(({ type }) => type === "month")?.value;
  const day = parts.find(({ type }) => type === "day")?.value;
  const year = parts.find(({ type }) => type === "year")?.value;
  return `${months[Number(month) - 1]} ${day}, ${year}`;
}

function weekLabel(start: string, end: string) {
  const first = calendarParts(start);
  const last = calendarParts(end);
  if (first.year !== last.year) return `${calendarLabel(start)} – ${calendarLabel(end)}`;
  if (first.month !== last.month) return `${first.month} ${first.day} – ${last.month} ${last.day}, ${last.year}`;
  return `${first.month} ${first.day}–${last.day}, ${last.year}`;
}

function moveCluster(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType !== "mouse") return;
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--drift-x", `${((event.clientX - bounds.left) / bounds.width - 0.5) * 14}px`);
  event.currentTarget.style.setProperty("--drift-y", `${((event.clientY - bounds.top) / bounds.height - 0.5) * 14}px`);
}

function resetCluster(event: PointerEvent<HTMLButtonElement>) {
  event.currentTarget.style.removeProperty("--drift-x");
  event.currentTarget.style.removeProperty("--drift-y");
}

function PreviewFrame({ preview }: { preview: Preview }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { imageUrl } = preview;
  return (
    <span className={styles.frame} data-platform={preview.platform}>
      {imageUrl && imageUrl !== failedUrl ? (
        // Source previews go directly to the browser without a shared image optimizer cache.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={preview.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(imageUrl)} />
      ) : (
        <span className={styles.previewFallback}>
          <span className={styles.videoGlyph} aria-hidden="true" />
          <span>Preview unavailable</span>
        </span>
      )}
      <span className={styles.frameMeta}>
        <span>{platformLabel[preview.platform]}</span>
        {preview.views !== null && <span>{numberFormat.format(preview.views)} views</span>}
      </span>
    </span>
  );
}

function Cluster({ opportunity, onOpen }: { opportunity: OpportunitySummary; onOpen: () => void }) {
  const { comparison, previews } = opportunity;
  return (
    <button
      id={`opportunity-${opportunity.id}`}
      className={styles.cluster}
      type="button"
      onClick={onOpen}
      onPointerMove={moveCluster}
      onPointerLeave={resetCluster}
      aria-labelledby={`topic-${opportunity.id} finding-${opportunity.id}`}
      aria-describedby={`comparison-${opportunity.id}`}
    >
      <span className={styles.clusterVisual} data-count={previews.length}>
        {previews.length === 0 && <span className={styles.clusterEmpty}>No clip previews available</span>}
        {previews.map((preview) => (
          <span className={styles.clusterClip} key={preview.postId}><PreviewFrame preview={preview} /></span>
        ))}
      </span>
      <span className={styles.clusterSummary}>
        <span className={styles.clusterSignal}>
          <span className={styles.statusDot} data-status={comparison.status} />
          <span>{statusLabel[comparison.status]}</span>
          <span className={styles.clusterPlatform}>{platformLabel[comparison.platform]}</span>
        </span>
        <span className={styles.clusterTitle} id={`topic-${opportunity.id}`}>{opportunity.topic}</span>
        <span className={styles.clusterFinding} id={`finding-${opportunity.id}`}>{opportunity.finding}</span>
        <span className={styles.clusterCounts} id={`comparison-${opportunity.id}`}>
          {comparison.priorAccounts !== null && comparison.status !== "observed"
            ? `${numberFormat.format(comparison.priorAccounts)} last week → ${numberFormat.format(comparison.currentAccounts)} this week`
            : `${numberFormat.format(comparison.currentAccounts)} ${comparison.currentAccounts === 1 ? "account" : "accounts"} observed this week`}
        </span>
        <span className={styles.clusterLink}>Open opportunity <span aria-hidden="true">↗</span></span>
      </span>
    </button>
  );
}

function StatusPanel({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className={styles.statusPanel}>
      <h2>{title}</h2>
      {children}
      {action}
    </section>
  );
}

function Overview({ brief, onOpen }: { brief: LatestBrief; onOpen: (id: string) => void }) {
  return (
    <div className={styles.overview}>
      <div className={styles.intro}>
        <div>
          {brief.state === "published" && <p className={styles.eyebrow}>{brief.category}</p>}
          <h1 id="brief-heading" tabIndex={-1}>This week’s<br />opportunities<span className={styles.period}>.</span></h1>
        </div>
        {brief.state === "published" && (
          <div className={styles.weekline}>
            <span className={styles.eyebrow}>Published week</span>
            <strong>{weekLabel(brief.weekStart, brief.weekEnd)}</strong>
            <span>Pacific time</span>
          </div>
        )}
      </div>
      {brief.state === "unpublished" ? (
        <StatusPanel title="No brief published yet"><p>The first reviewed week will appear here when it’s published.</p></StatusPanel>
      ) : (
        <>
          {brief.opportunities.length ? (
            <section className={styles.clusterGrid} aria-label="Weekly opportunities" data-count={brief.opportunities.length}>
              {brief.opportunities.map((opportunity) => <Cluster key={opportunity.id} opportunity={opportunity} onOpen={() => onOpen(opportunity.id)} />)}
            </section>
          ) : (
            <StatusPanel title="No qualifying opportunities this week"><p>The reviewed brief recorded zero opportunities that met the evidence requirements.</p></StatusPanel>
          )}
          <section className={styles.coverage} aria-label="Source coverage"><span>Source coverage</span><p>{brief.coverageNote}</p></section>
        </>
      )}
    </div>
  );
}

function LoadingDetail() {
  return (
    <div className={styles.loading} role="status">
      <p>Loading opportunity…</p>
      <div className={styles.skeletonGrid} aria-hidden="true"><span /><span /><span /></div>
    </div>
  );
}

function ComparisonCard({ comparison, period }: { comparison: Comparison; period: OpportunityDetail["period"] }) {
  const { priorAccounts, currentAccounts, priorTrackedAccounts, currentTrackedAccounts, note } = comparison;
  return (
    <article className={styles.comparisonCard}>
      <div className={styles.comparisonHeader}>
        <h3>{platformLabel[comparison.platform]}</h3>
        <span className={styles.comparisonStatus}><span className={styles.statusDot} data-status={comparison.status} />{statusLabel[comparison.status]}</span>
      </div>
      <dl className={styles.comparisonNumbers}>
        <div>
          <dt>Prior week<small>{weekLabel(period.priorWeekStart, period.priorWeekEnd)}</small></dt>
          <dd>{priorAccounts === null
            ? <small>Unavailable</small>
            : <>{numberFormat.format(priorAccounts)}{priorTrackedAccounts !== null && <small> / {numberFormat.format(priorTrackedAccounts)} tracked</small>}</>}
          </dd>
        </div>
        <div>
          <dt>Brief week<small>{weekLabel(period.weekStart, period.weekEnd)}</small></dt>
          <dd>{numberFormat.format(currentAccounts)}<small> / {numberFormat.format(currentTrackedAccounts)} tracked</small></dd>
        </div>
      </dl>
      {note && <p>{note}</p>}
    </article>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className={styles.external} href={href} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">↗</span></a>;
}

function Evidence({ detail }: { detail: OpportunityDetail }) {
  const [postId, setPostId] = useState(detail.posts[0]?.postId);
  const postRef = useRef<HTMLElement>(null);
  const selectedPost = detail.posts.find((post) => post.postId === postId) ?? detail.posts[0];
  const selectedComments = detail.comments.filter((comment) => comment.postId === selectedPost?.postId);

  function showPost(id: string) {
    setPostId(id);
    requestAnimationFrame(() => {
      postRef.current?.focus({ preventScroll: true });
      postRef.current?.scrollIntoView({ block: "nearest" });
    });
  }

  return (
    <section className={styles.evidence} aria-labelledby="evidence-heading">
      <div className={styles.evidenceHeading}>
        <h2 id="evidence-heading">Source evidence</h2>
        <span>{detail.posts.length} {detail.posts.length === 1 ? "post" : "posts"}</span>
      </div>
      <div className={styles.evidenceGrid}>
        <div>
          <div className={styles.evidenceStrip} aria-label="Supporting posts">
            {detail.posts.map((post) => (
              <button key={post.postId} className={styles.evidenceClip} type="button" aria-label={`Inspect ${platformLabel[post.platform]} post: ${post.alt}`} aria-pressed={post.postId === selectedPost?.postId} onClick={() => showPost(post.postId)}>
                <PreviewFrame preview={post} />
              </button>
            ))}
          </div>
          {selectedPost && (
            <article className={styles.postDetail} ref={postRef} tabIndex={-1} aria-label="Selected post details">
              <div className={styles.postHeader}>
                <h3>{platformLabel[selectedPost.platform]} post</h3>
                {selectedPost.sourceUrl ? <ExternalLink href={selectedPost.sourceUrl}>Open original post</ExternalLink> : <span className={styles.muted}>Original post unavailable</span>}
              </div>
              <p className={styles.postDates}>
                Published <time dateTime={selectedPost.publishedAt}>{observationLabel(selectedPost.publishedAt)}</time>
                <span aria-hidden="true"> · </span>
                Observed <time dateTime={selectedPost.observedAt}>{observationLabel(selectedPost.observedAt)}</time>
              </p>
              {selectedPost.note && <p>{selectedPost.note}</p>}
              <p className={styles.postAvailability}>{availabilityLabel[selectedPost.commentAvailability]}</p>
              {selectedComments.map((comment) => (
                <figure className={styles.postComment} key={comment.id}>
                  <blockquote>{comment.excerpt}</blockquote>
                  <figcaption>
                    Observed <time dateTime={comment.observedAt}>{observationLabel(comment.observedAt)}</time>
                    {comment.sourceUrl && <ExternalLink href={comment.sourceUrl}>Open comment</ExternalLink>}
                  </figcaption>
                </figure>
              ))}
            </article>
          )}
        </div>
        <section className={styles.shopperPanel} aria-labelledby="shopper-heading">
          <span className={styles.eyebrow}>Shopper question</span>
          <h3 id="shopper-heading">{detail.shopperQuestion}</h3>
          {detail.comments.map((comment) => (
            <figure key={comment.id} className={styles.shopperQuote}>
              <blockquote>{comment.excerpt}</blockquote>
              <figcaption><button className={styles.textButton} type="button" onClick={() => showPost(comment.postId)}>Inspect source post <span aria-hidden="true">↗</span></button></figcaption>
            </figure>
          ))}
          {detail.comments.length === 0 && <p className={styles.muted}>No supporting comment excerpts are available.</p>}
        </section>
      </div>
    </section>
  );
}

function Detail({ detail, category, illustrative }: { detail: OpportunityDetail; category?: string; illustrative: boolean }) {
  return (
    <>
      <div className={styles.detailLead}>
        <div className={styles.detailIntro}>
          <p className={styles.eyebrow}>{category && `${category} · `}{weekLabel(detail.period.weekStart, detail.period.weekEnd)} · Pacific time</p>
          <h1 id="detail-heading" tabIndex={-1}>{detail.topic}</h1>
          <p>{detail.finding}</p>
        </div>
        <section className={styles.pitch} aria-labelledby="pitch-heading">
          <span className={styles.eyebrow}>{detail.pitch.format === "tiktok-live" ? "TikTok LIVE" : "Creator video"}</span>
          <h2 id="pitch-heading">What to pitch</h2>
          <strong>{detail.pitch.test}</strong>
          <p>{detail.pitch.rationale}</p>
        </section>
      </div>
      <div className={styles.detailSummary}>
        <section aria-labelledby="comparison-heading">
          <h2 className={styles.sectionHeading} id="comparison-heading">Accounts posting about this topic</h2>
          <div className={styles.comparisonGrid}>
            {detail.comparisons.map((comparison) => <ComparisonCard key={comparison.platform} comparison={comparison} period={detail.period} />)}
          </div>
        </section>
        <section className={styles.product} aria-labelledby="product-heading">
          <span className={styles.eyebrow}>Product match</span>
          <h2 id="product-heading">{detail.product.brand}</h2>
          <strong>{detail.product.name}</strong>
          <p>{detail.product.fit}</p>
          {detail.product.sizeBasis && <p>{detail.product.sizeBasis}</p>}
          <div className={styles.productLink}>
            <ExternalLink href={detail.product.sourceUrl}>{illustrative ? "Illustrative product link" : "View product source"}</ExternalLink>
            {detail.product.brandSourceUrl && <ExternalLink href={detail.product.brandSourceUrl}>View brand source</ExternalLink>}
            <span>Checked <time dateTime={detail.product.checkedOn}>{calendarLabel(detail.product.checkedOn)}</time></span>
          </div>
        </section>
      </div>
      <Evidence key={detail.id} detail={detail} />
      {detail.uncertainties.length > 0 && (
        <aside className={styles.uncertainty} aria-labelledby="uncertainty-heading">
          <h2 id="uncertainty-heading">What’s still unknown</h2>
          <ul>{detail.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul>
        </aside>
      )}
    </>
  );
}

function DetailContent({ id, category, fixtureDetails }: {
  id: string;
  category?: string;
  fixtureDetails?: Record<string, OpportunityDetail>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; result: LoadedDetail }>();
  const fixture = fixtureDetails && Object.hasOwn(fixtureDetails, id) ? fixtureDetails[id] : undefined;
  const result: LoadedDetail | undefined = fixtureDetails
    ? fixture ? { kind: "ready", detail: fixture } : { kind: "missing" }
    : loaded?.attempt === attempt ? loaded.result : undefined;

  useEffect(() => {
    if (fixtureDetails) return;
    const controller = new AbortController();
    async function loadDetail(selectedId: string) {
      let result: LoadedDetail;
      try {
        const response = await fetch(`/api/opportunities/${encodeURIComponent(selectedId)}`, { cache: "no-store", signal: controller.signal });
        if (response.ok) {
          const parsed = opportunityDetailSchema.safeParse(await response.json());
          result = parsed.success && parsed.data.id === selectedId ? { kind: "ready", detail: parsed.data } : { kind: "error" };
        } else {
          switch (response.status) {
            case 401: result = { kind: "expired" }; break;
            case 403: result = { kind: "forbidden" }; break;
            case 404: result = { kind: "missing" }; break;
            default: result = { kind: "error" };
          }
        }
      } catch {
        result = { kind: "error" };
      }
      if (!controller.signal.aborted) setLoaded({ attempt, result });
    }
    void loadDetail(id);
    return () => controller.abort();
  }, [attempt, fixtureDetails, id]);

  if (!result) return <LoadingDetail />;
  if (result.kind === "ready") return <Detail detail={result.detail} category={category} illustrative={Boolean(fixtureDetails)} />;
  if (result.kind === "expired") return <StatusPanel title="Your session has expired" action={<a className={styles.external} href={`/login?next=${encodeURIComponent(`/?opportunity=${encodeURIComponent(id)}`)}`}>Sign in again</a>} />;
  if (result.kind === "forbidden") return <StatusPanel title="Access unavailable"><p>This account doesn’t have an active membership for the brief.</p></StatusPanel>;
  if (result.kind === "missing") return <StatusPanel title="Opportunity unavailable"><p>Return to the latest brief to see available opportunities.</p></StatusPanel>;
  return <StatusPanel title="Unable to load the opportunity" action={<button className={styles.back} type="button" onClick={() => setAttempt((previous) => previous + 1)}>Retry</button>}><p role="alert">The detail couldn’t be retrieved.</p></StatusPanel>;
}

export default function WeeklyBrief({ brief, fixtureDetails, accountAction }: {
  brief: LatestBrief;
  fixtureDetails?: Record<string, OpportunityDetail>;
  accountAction?: ReactNode;
}) {
  const id = useSyncExternalStore(subscribeToSelection, readSelection, () => null);
  const origin = useRef<{ id: string; scroll: number } | null>(null);
  const detailStart = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (id) {
        if (origin.current?.id !== id) origin.current = { id, scroll: 0 };
        window.scrollTo({ top: 0, behavior: "instant" });
        detailStart.current?.focus({ preventScroll: true });
        return;
      }
      const previous = origin.current;
      if (previous) {
        const element = document.getElementById(`opportunity-${previous.id}`) ?? document.getElementById("brief-heading");
        element?.focus({ preventScroll: true });
        window.scrollTo({ top: previous.scroll, behavior: "instant" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.repeat) updateSelection(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [id]);

  function open(id: string) {
    origin.current = { id, scroll: window.scrollY };
    updateSelection(id);
  }

  const category = brief.state === "published" && brief.opportunities.some((opportunity) => opportunity.id === id) ? brief.category : undefined;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.brand}><span className={styles.brandMark} aria-hidden="true" /><span>Outlandish</span></span>
          <div className={styles.headerActions}>{fixtureDetails && <span className={styles.demoLabel}>Illustrative demo</span>}{accountAction}</div>
        </div>
      </header>
      <main className={styles.main}>
        {id ? (
          <div className={styles.detailView} ref={detailStart} tabIndex={-1} role="region" aria-label="Opportunity detail">
            <button className={styles.back} type="button" onClick={() => updateSelection(null)}><span aria-hidden="true">←</span> Back to opportunities</button>
            <DetailContent key={id} id={id} category={category} fixtureDetails={fixtureDetails} />
          </div>
        ) : <Overview brief={brief} onOpen={open} />}
      </main>
    </div>
  );
}

# Oriane collection

Use Node 24 from the project root. The private demo reads saved revisions. Only the collector contacts Oriane.

## Account setup

Put `ORIANE_API_KEY` in the gitignored `.env.local` and the collection environment of the intended Vercel project. In Vercel, open the project’s Settings → Environment Variables and select the intended deployment environment. Redeploy after changing server variables. The worker also needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`). Apply the project’s Supabase migrations in ascending filename order. The local probe uses no Supabase connection.

Set numeric request limits only after the owner approves the **number of attempted requests and requested results**. Oriane’s published REST response schemas expose neither credits consumed nor currency charged. For an allowance stated in credits or dollars, establish provider pricing or an account hard limit before collection. The software cannot enforce an unknown exchange rate.

| Server setting | Scope |
|---|---|
| `ORIANE_PROBE_REQUEST_LIMIT` | Local probe cap, 1–9 HTTP attempts per reporting week. Workspace authentication and one single-result search per platform take three successful attempts. |
| `ORIANE_REFRESH_REQUEST_LIMIT` | Per-week discovery cap, 1–87 HTTP attempts across all workers. Full coverage takes one authentication and 28 successful searches. |
| `ORIANE_ROWS_PER_SLICE` | Requested results per search (1–100). The default is unset. Two weeks at a setting of 5 request at most 140 results before retries. |
| `CRON_SECRET` | Secret server-side bearer for the hosted collector. Use the same secret in the scheduler. |
| `ORIANE_CRON_ENABLED` | Set to `true` only after approving recurring collection and its budget. |

## Probe

```sh
node --env-file-if-exists=.env.local scripts/collect.ts probe
```

The CLI calls `GET /rest/workspace?projection=basic` and two separate `POST /rest/contents/search` requests with platform, video format, publication bounds, a one-row limit and full projection. It prints an actual observation time and redacted field and row counts per successful query. A populated key, a fixture test or workspace authentication alone cannot prove either platform is available.

The first run creates a private SQLite checkpoint in `.outlandish/collection`. Each attempt is reserved transactionally before the HTTP call, including retries, so repeated invocations and ambiguous timeouts consume the same allowance. A later run honors a lower configured cap immediately. To retry after fixing credentials or to apply an explicitly increased allowance, invoke `probe --resume`. A rerun returns settled pages without new provider requests. Keep the checkpoint and use the same operator checkout to preserve that allowance.

Read a returned row locally for editorial verification (never publish this private database):

```sh
sqlite3 .outlandish/collection/probe-YYYY-MM-DD.sqlite "select json_extract(result,'$.posts[0]') from attempts where state='done' and json_array_length(result,'$.posts')>0;"
```

The provider returns content and platform IDs, captions, nullable metrics, full media, thumbnails and a popular-comment subset. The collector retains the distinction between absent, empty and populated subsets. It retains nullable raw counts separately from comment text. A TikTok handle plus numeric ID creates an unverified URL candidate. A numeric Instagram ID has no documented shortcode conversion in the provider contract. Actual source verification and opening the product page are editorial review steps. Full media describes frames, OCR and transcript. A thumbnail or frame cannot establish direct playback.

## Discovery and checkpoints

```sh
node --env-file-if-exists=.env.local scripts/collect.ts refresh
node --env-file-if-exists=.env.local scripts/collect.ts status RUN_ID
```

Each refresh advances a short batch toward the last two complete Monday–Sunday Pacific weeks. Repeat the command while the status is `open`, respecting `nextAttemptAt`. The weekly run has a stable ID and original budget. Store reservations before I/O, settle the observations and checkpoint in one SQL transaction, and retain separate rows for posts, profiles, comments and media. Charged-but-lost calls remain counted. A timed-out worker’s lease expires after 90 seconds. Tickets with short-lived provider failures can be tried at most three times, always within budget. A denial on one content platform is recorded separately. A workspace authentication failure, invalid key, exhausted provider quota or spent request allowance halts further affected requests.

Both platforms and both windows use the same limit, one full-projection page per weekday, ordered by publication time. Each weekday samples a rotating eighth of its Pacific day; the same weekday in the other week uses the same fraction. Each slice records its exact UTC range, query hash, total matches (when present), returned rows, accepted rows, attempts and status. This limits last-hour bias across days while retaining a recency bias within each slot. `offset=0` is intentional; no second page or visual-similarity pagination is used. Provider bounds are inclusive; the query ends one millisecond before the half-open boundary and the collector checks the timestamps locally. A completed query with zero results is a real observation. A denied or skipped query has unknown counts.

For eligible failed queries after addressing the reason or obtaining more budget, first set the explicitly approved `ORIANE_REFRESH_REQUEST_LIMIT`, then run:

```sh
node --env-file-if-exists=.env.local scripts/collect.ts resume RUN_ID
node --env-file-if-exists=.env.local scripts/collect.ts refresh RUN_ID
```

Resume preserves previous counts and settled pages and will never increase the three-attempt lifetime limit per query. A repeated refresh does not alter a published revision or publish a draft.

## Hosted collection

The authenticated `POST /api/collection/refresh` advances the same checkpoint as the local CLI. Vercel Cron can call `GET /api/collection/refresh` with its `Authorization: Bearer` secret after `ORIANE_CRON_ENABLED=true`. Configure the schedule on the owner-approved cadence so that the same reporting week receives enough calls to finish. Use repeated short invocations for a weekly refresh (including retries); one invocation alone may leave an open checkpoint. Check the operator status after collection. To configure Vercel Cron, add a `crons` entry in the project's `vercel.json` with path `/api/collection/refresh` and the owner's approved UTC cron expression, set the production environment variables, and deploy. Check the project's Cron Jobs settings after deployment. Collection remains disabled until a schedule and its budget are configured. [Vercel Cron setup](https://vercel.com/docs/cron-jobs/quickstart) · [Cron authorization](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

Both methods require the server secret and respond with private, noncacheable summaries. A visitor opening or panning the scene cannot spend provider quota. Operators with the Supabase secret may retrieve the stored run for analysis; ordinary viewer/editor sessions cannot invoke collection SQL functions. Private source, comments, media and workspace identifiers belong in the local checkpoint/Supabase, outside the public repository.

[Oriane REST reference](https://connect.oriane.xyz/rest/docs)

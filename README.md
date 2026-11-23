# Outlandish weekly brief

An independent internship demo for social commerce prospecting. It turns a reviewed week of TikTok and Instagram observations into an invite-only brief. Each opportunity pairs a shopper question with a smaller brand's verified product and a creator video or TikTok LIVE to pitch.

## Run the local demo

Use Node.js 24 and npm.

```sh
npm ci
npm run dev:fixture
```

Open [localhost:3000](http://localhost:3000). The illustrated brief has fictional observations and source placeholders. It runs without an account, in development only. Use `?fixture=empty` and `?fixture=unpublished` for the two empty states.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium --only-shell
npm run test:browser
```

Leave the fixture server running in another terminal for browser tests. Set `OUTLANDISH_TEST_URL` if the server runs on a different port. If filesystem watching fails on macOS, run `WATCHPACK_POLLING=true npm run dev:fixture -- --webpack`. SQL tests execute the migrations on embedded Postgres with a test-only Auth shim. Test hosted sign-in and email delivery in the intended Supabase project.

## Configure the private app

1. Create or select a Supabase project. Apply the files in `supabase/migrations` in order in the SQL Editor or with the Supabase CLI. For local development copy `.env.example` to `.env.local` and enter the project URL and publishable key.
2. Import the GitHub repository in Vercel, use Node.js 24 and configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for each deployment environment. Keep the operator secret off Vercel. Deploy the intended branch, then set its origin as the Supabase Auth Site URL and allow its `/auth/confirm` callback. Add the local callback if you will test it.
3. In Supabase Auth, configure the Magic Link email template to show the one-time code `{{ .Token }}`. For an initial dashboard invitation, point the link in the Invite template to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`. Set Site URL without a trailing slash. Supabase's default email sender is restricted to authorized project team addresses. Configure custom SMTP to email an approved viewer outside that team.
4. Invite the authorized viewer from Supabase Auth. Add their user ID to the membership table using the SQL Editor. The statement should affect exactly one row. Use `editor` for an approved editor. Import and publish commands separately require the operator credential.

```sql
insert into outlandish_private.memberships (user_id, role)
select id, 'viewer' from auth.users where email = 'INVITED_EMAIL'
on conflict (user_id) do update set role = excluded.role, active = true;
```

Confirm in a clean session that `/api/briefs/latest` returns 401 and the page prompts for login. Sign in with the invited account, then verify the latest published week, a direct opportunity URL, refresh, and sign-out. A signed-in Auth user without an active membership gets 403. Supabase project access is separate from application membership.

References [Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates) · [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) · [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) · [Deploy from GitHub](https://vercel.com/docs/git/vercel-for-github)

## Import and publish a week

The editor uses four CSVs and a batch manifest. Both weeks must use the same tracked accounts and sampling method on at least one platform. Include coverage rows for checked accounts with zero matches. Keep actual input, drafts and reviews under `data/private/` or `.outlandish/`.

Try the workflow against the illustrative importer fixture with no Supabase credentials.

```sh
npm run editorial -- import --dir data/fixtures/illustrative
npm run editorial -- preview --dir data/fixtures/illustrative \
  --category "Beauty tools" --cohort illustrative --week 2026-11-16 \
  --as-of 2026-11-24T00:00:00Z
```

For real data, copy `data/templates/` to `data/private/week/` and fill the five files. In the operator environment set `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, plus `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`. Use the category, cohort key and week start from the CSVs. Generate fresh output filenames for every new preview.

```sh
npm run editorial -- import --dir data/private/week
npm run editorial -- import --dir data/private/week --apply
npm run editorial -- preview --remote --category "Beauty tools" --cohort heatless-curls \
  --week 2026-11-09 --out .outlandish/draft.json --review-template .outlandish/review.json
```

Read the draft and review the linked sources. In the review JSON retain `draftFingerprint` and record a decision and rationale for every candidate. For an accepted candidate set `decision` to `accept`, add `rank` starting at 1, the qualifying `platform`, the `questionKey` from the draft, and the viewer-facing `finding`. Include `emptyReason` for a reviewed zero-opportunity week. Omit it for a populated brief.

```sh
npm run editorial -- publish --category "Beauty tools" --cohort heatless-curls \
  --week 2026-11-09 --review .outlandish/review.json
npm run editorial -- publish --category "Beauty tools" --cohort heatless-curls \
  --week 2026-11-09 --review .outlandish/review.json --apply
```

The first publish command previews the revision change. The second swaps the active revision in one transaction. To correct a week, re-import amended observations, preview and review again, then publish. When an older fingerprint is replayed, its existing revision is returned and the active correction stays in place. Previously published links still resolve for invited members.

## One-minute walkthrough

1. Read the week and coverage note. Choose the best-supported opportunity.
2. Compare how many tracked accounts covered the topic in each period. Open the shopper question and select a quote to inspect its original post.
3. Open the verified product link. Describe the specific video or LIVE test and the question it answers.
4. Close the opportunity and return to the weekly overview. Publish a new reviewed week and refresh the same URL.

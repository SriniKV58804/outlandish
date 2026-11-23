# Outlandish discovery

A private weekly prospecting tool for a TikTok Shop agency. The collector samples product conversations across TikTok and Instagram through Oriane. An editor checks the post, shopper question and seller before publishing a campaign idea. Opening or moving around the scene reads a saved revision and costs no provider requests.

## Run locally

Use Node.js 24.

```sh
npm ci
npm run dev
```

Open [the local visual preview](http://localhost:3000/preview) to try the camera and video controls. It uses licensed films and photographs and has no live shopper or trend data. The [private home route](http://localhost:3000/) reads the approved Supabase revision. Local development on a Mac with limited file-watch support can use `WATCHPACK_POLLING=true npm run dev -- --webpack`.

## Connect Supabase and Vercel

1. Create or select the intended Supabase project. Enable the Data API and row-level security. Explicit grants in the migrations cover the app. Retrieve the Project URL from **Connect** and the publishable and secret keys from **Settings → API Keys**.
2. Fill in the gitignored `.env.local` using `.env.example`. Put the same three Supabase variables in the Vercel project's Production environment. The publishable key and URL support viewer sign-in. Only the collector and operator use the server secret. Enter `ORIANE_API_KEY` in the environments that collect. Redeploy after changing Vercel variables.
3. From the repository root, use the Supabase CLI to sign in, link this specific project and apply the migrations. Use the reference from Supabase's project settings. Review the dry run before applying. The same command applies new migrations on future updates.

```sh
npx supabase login
npx supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

4. In **Authentication → URL Configuration**, set the Site URL to the Vercel production origin. Allow its exact `/auth/confirm` callback and the local callback if testing locally. Disable public sign-ups. In **Email Templates**, include `{{ .Token }}` in the Magic Link template for code sign-in. For invitation emails, use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`. Configure SMTP if the intended viewer is outside the project team's default email allowance.
5. In **Authentication → Users**, invite the intended viewer. Then use the Supabase SQL Editor to grant access to that exact user. Use the invited email in the statement and confirm a single user was returned.

```sql
insert into outlandish_private.memberships (user_id, role)
select id, 'viewer' from auth.users where email = 'YOUR_INVITED_EMAIL'
on conflict (user_id) do update set role = excluded.role, active = true
returning user_id, role;
```

The private viewer opens `/`. Members see an empty state until an editor approves a real collection. Production hides `/preview` by default. Set `OUTLANDISH_ENABLE_PREVIEW=1` for an authenticated hosted visual study.

## Run, review and publish

- [Collector and cost controls](docs/collection.md) covers the two single-result platform probes, bounded weekly samples, status, safe resumption and the protected job endpoint.
- [Editor guide](docs/review.md) covers candidate extraction, real source and product checks, private drafts, publishing and archived corrections.
- Use `npm run analyze -- --run RUN_ID` to inspect the normalized evidence. Use `npm run analyze -- --replay PATH` to analyze a saved private capture with its replay marker.
- The CSV tool supports older research archives. The public viewer and discovery publication paths read the new weekly schema.
- Private research, source accounts, deployment credentials and operator notes belong outside Git. Licensed preview assets have source credits in `public/discovery-media/CREDITS.md`.

## Verify

```sh
npm run typecheck
npm test
npm run build
```

For browser tests, leave the local development server running, install the test browser with `npx playwright install chromium --only-shell`, and run `npm run test:browser`. Testing the hosted app also requires an invited viewer, a real Supabase database and checked source media.

## One-minute walkthrough

1. Open the private home page. Read the reporting week, then drag across the landscape. The nearest clips move farther than the distant ridge.
2. Select a topic and then a clip. Play it or open the verified original. Read the actual shopper question next to it.
3. Open the seller's specific product. Explain what the proposed creator video or LIVE would demonstrate in response to the question.
4. Close the clip and then the topic. The viewport returns to its prior position. Open the coverage details for sample sizes and dates.

For a visual rehearsal without an account, use the local preview. Its evidence panel identifies the stock material and leaves customer claims empty.

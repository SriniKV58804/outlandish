# Archived CSV research importer

For the current discovery app, see [Oriane collection](../docs/collection.md) and [review and publication](../docs/review.md). The following commands reproduce older CSV research separately.

Use Node 24 and run the commands from the project directory. Keep CSVs, generated drafts and review files under gitignored `data/private/`. Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the operator environment or `.env.local`. A legacy service-role JWT can use `SUPABASE_SERVICE_ROLE_KEY`. The viewer uses a separate publishable key. Apply the Supabase migrations before running an operation against the database.

## Enter observations

Copy the files in `data/templates/` to `data/private/week/batch/`. Keep all four CSV headers and `batch.json`. Each sheet maps to one CSV file in that directory.

| File | How to enter a row |
|---|---|
| `accounts.csv` | Add one row per tracked account, platform, cohort and Monday. Include accounts with zero qualifying posts. Use the same account keys and sampling rule in both weeks. Record `complete` only after checking every post required by the rule after the week ends. Otherwise use `partial` or `unknown` with a reason. A change to the account roster across separately collected cohorts should use a new cohort key. |
| `posts.csv` | Add one full TikTok post or Instagram reel/post URL per row. Leave `post_key` blank to use the post ID from the URL. Reuse the account key from the coverage sheet. Use ISO timestamps with offsets for original publication and observation. Separate reviewed topics with `\|`. Empty metrics mean missing, while 0 is measured. Record comment access and give copies of the same footage a common `repost_key` when identified. |
| `comments.csv` | Use exact observed excerpts and the parent post key. Use `available` or `partial` on the parent only when the excerpt could be verified. Use the same reviewed question theme for remarks about the same question. Add a non-identifying `independence_key` when the same viewer is known to have left more than one comment. Leave `source_url` blank when the post is the available source. Identical excerpt text and identified reposts do not count as independent corroboration. |
| `prospects.csv` | Record the exact product and first-party or identified storefront URL, check date, claim supporting product fit, evidence for prospect size, proposed test and its rationale. Use `creator-video` or `tiktok-live`. Add uncertainty and private editor notes separately. |

For real evidence, `batch.json` uses `"fixture": false`. Keep category spelling consistent throughout. The importer rejects malformed rows and duplicate keys with conflicting facts before attempting a write. Apply a corrected import explicitly to update an existing observation. The previous publication keeps its frozen snapshot.

## Validate, import and preview

```sh
npm run editorial -- import --dir data/private/week/batch
npm run editorial -- import --dir data/private/week/batch --apply
npm run editorial -- preview --remote --category "Beauty tools" --cohort <cohort-key> --week <YYYY-MM-DD> --out data/private/week/draft.json --review-template data/private/week/review.json
```

Replace the placeholders with the cohort key and Monday date. The preview command defaults to the latest completed Pacific week when `--week` is omitted. Publication requires an explicit week. For an offline preview of validated CSVs, pass `--dir data/private/week/batch` instead of `--remote`. Preview output paths must be new files.

Open the draft and independently verify the source posts, exact excerpts, matching product and pitch. In the review file, record a decision for each candidate. A declined candidate records a rationale. An accepted candidate records a consecutive rank from 1, the rising platform supporting rank, a question key from the draft, and a viewer-facing finding supported by the evidence. Select one prospect per topic. Rank opportunities within the same platform by the absolute weekly increase in distinct posting accounts and use the rationale to document ties and cross-platform ordering. For a verified zero-opportunity week, record the reason in `emptyReason`. Use complete, comparable coverage on at least one platform to publish a brief.

An accepted review entry has this shape. Use the IDs and labels in your draft.

```json
{
  "candidateId": "candidate-id-from-draft",
  "decision": "accept",
  "rationale": "Why the reviewed prospect and pitch make sense at this rank",
  "rank": 1,
  "platform": "tiktok",
  "questionKey": "reviewed question key from the draft",
  "finding": "Short, source-backed finding that appears on the brief"
}
```

## Review the change and publish

```sh
npm run editorial -- publish --category "Beauty tools" --cohort <cohort-key> --week <YYYY-MM-DD> --review data/private/week/review.json
npm run editorial -- publish --category "Beauty tools" --cohort <cohort-key> --week <YYYY-MM-DD> --review data/private/week/review.json --apply
```

Run the first command and review the proposed revision and topic changes. The second command revalidates the review against the current observations and atomically switches the active revision. A stale review requires a new preview. Repeating an unchanged active publication returns the existing revision. For a correction, import the adjusted evidence, generate and review a new draft, and publish for the same week. Older evidence links keep their original snapshot.

## Exercise the illustrative fixture

This practice batch contains fabricated observations and example URLs. It can be validated and analyzed locally.

```sh
npm run editorial -- import --dir data/fixtures/illustrative
npm run editorial -- preview --dir data/fixtures/illustrative --category "Beauty tools" --cohort illustrative --week 2026-11-16 --as-of 2026-11-24T00:00:00Z
```

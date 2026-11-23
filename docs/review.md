# Review and publish a discovery run

Run these commands on the trusted operator machine from the project root. All four database migrations must be applied to the intended Supabase project. Set its URL and server secret locally. The collector prints the discovery run UUID. Keep source excerpts, private links, screenshots and filled review forms under gitignored `data/private/`. Review and publication use stored observations and make zero Oriane requests.

```sh
mkdir -p data/private/review
npm run --silent review -- candidates "$RUN_ID" > data/private/review/candidates.json
npm run --silent review -- template "$RUN_ID" > data/private/review/review.json
npm run --silent review -- checklist "$RUN_ID" "$TOPIC_KEY" > data/private/review/approval.json
```

`RUN_ID` is the UUID from collection. `TOPIC_KEY` is a ranked key from candidates. The candidates output includes exact observed mentions, source post IDs, available question IDs, sample coverage and the current published revision for that week. Seller leads show the observed author, links or shop language that led to the suggestion. A lead needs a verified storefront and ownership evidence before approval. Candidates with no eligible seller can be held or skipped.

The template puts every ranked topic on hold. Fill the approval checklist and use it to replace the corresponding decision in the review. Multiple decisions can be reviewed together. A maximum of three may be approved. Their order follows the discovery ranking. Add an optional `aliases` object to merge an observed phrase into another topic or discard an erroneous phrase with a null value. When merging, use the resulting key in the decision. Use the analysis CLI to inspect the corrected grouping first.

## What to verify

1. Open the actual platform post on a desktop and a phone. Record the final post URL, verification timestamp, and the handle plus identifying caption, product or frame in `source.evidence`. Include whether a signed-in session was needed. Set both `desktop` and `mobile` to `visible` only after seeing that exact post on those surfaces. A login prompt, a generic profile, an HTTP success status or an error page does not verify the clip. An Instagram numeric ID is insufficient to construct a shortcode.
2. Open the observed thumbnail and check that it depicts the selected clip. Record `thumbnailCheckedAt`, its known `thumbnailExpiresAt` or null, `thumbnailUse` as `approved-for-private-display`, and the actual account agreement or permission basis in `thumbnailBasis`. A missing permission or unusable image calls for another source or a hold. If its known expiry has passed, the opening scene withdraws the image. For native playback, add an optional `embed` object with a checked canonical TikTok player or Instagram embed for that same post. Verify actual playback on both surfaces. Otherwise the clip opens its original post.
3. Select the exact IDs in `selectedCommentIds` under their parent post. The publisher copies the provider's original text, observed time and available creation date. One verified question can support a single observation. Use separate posts and corroborating questions before calling interest recurring. Keep shopper interest distinct from sales.
4. Check the brand's public business profile, its exact product and the first-party page that establishes ownership. For each page record the final URL, `checkedAt`, desktop/mobile result and specific visible evidence. Record why the seller owns or sells this product, the basis or uncertainty for estimating size, and why the proposed creator video or LIVE would address the observed question.
5. Record the actual trial and rationale in `pitch` and any material unknowns in `uncertainties`. A held or skipped candidate needs a reason. An empty week requires a decision for every ranked candidate.

## Preview, publish and correct

```sh
npm run review -- preview "$RUN_ID" data/private/review/review.json
npm run review -- save "$RUN_ID" data/private/review/review.json
npm run review -- publish "$RUN_ID" data/private/review/review.json
```

Preview makes no writes. Save persists analysis and the reviewed draft. The trusted operator publishes after validation. A complete, live discovery collection or a partial collection with a fully matched platform is required. The provider workspace check must have succeeded. Probes, replay, hand-entered CSV samples and fixtures cannot supply a publishable run.

For a correction, inspect the week's `activeRevision` in the candidates output, then pass it after the corrected review filename. Another editor's conflicting revision aborts the switch. Repeating the same accepted publication returns its existing revision without reactivating an older one.

```sh
npm run review -- publish "$RUN_ID" data/private/review/review.json "$ACTIVE_REVISION_ID"
```

The active overall revision for the latest published week opens at the private application root. Invited viewers can follow `/?opportunity=<revision-specific-id>` to its original publication. Database membership is checked on every request. Earlier publications retain their original collection date, excerpts, decisions and private analysis. A failed refresh or publication leaves the previous revision active.

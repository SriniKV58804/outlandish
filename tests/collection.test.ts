import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { makePlan, pacificMidnight } from "../lib/collection/plan.ts";
import { fetchQuery, ProviderError } from "../lib/collection/provider.ts";
import { configuredPlan } from "../lib/collection/worker.ts";
import type { CollectionSnapshot } from "../lib/collection/types.ts";

const now = new Date("2026-11-09T09:00:00Z");
const plan = makePlan("discovery", 29, 5, now);
const source = plan.queries[1];

test("plan pairs every Pacific weekday across platforms and weeks, honoring DST", () => {
  assert.equal(plan.weekStart, "2026-11-02");
  assert.equal(plan.queries.length, 29);
  assert.equal(pacificMidnight("2026-11-02") - pacificMidnight("2026-11-01"), 25 * 3600_000);
  assert.equal(pacificMidnight("2026-03-09") - pacificMidnight("2026-03-08"), 23 * 3600_000);
  assert.equal(new Set(plan.queries.map(q => q.key)).size, 29);
  for (const query of plan.queries.slice(1)) {
    const other = plan.queries.find(c => c.platform !== query.platform && c.day === query.day);
    assert.equal(query.start, other?.start);
    assert.equal(query.end, other?.end);
    assert.equal(query.limit, 5);
    assert.equal(query.offset, 0);
  }
  assert.throws(() => configuredPlan("discovery", {}), /ORIANE_API_KEY/);
  assert.throws(() => configuredPlan("probe", { ORIANE_API_KEY: "test" }), /approved/);
});

test("full projections preserve real fields, missing values, native source limits and half-open bounds", async () => {
  const row = { id: "content", platform: source.platform, platformId: "123", profileId: "profile", profileHandle: "handle",
    format: "video", publishedAt: source.start, title: "A", caption: "A product", viewsCount: 0, commentsCount: 8,
    thumbnailMediaUrl: "https://assets.invalid/preview", media: [{ onScreenText: ["Folding"], transcriptChunks: [{text:"Hello"}],
      frames: [{ id:"frame",url:"https://assets.invalid/frame",timestampSeconds:0,onScreenTextRegions:[{text:"desk"}]}]}],
    popularComments: [{platformId:"c1",content:"Actual comment",likesCount:0}] };
  let body: Record<string, any> = {};
  const page = await fetchQuery(source,"unit-key",async (uri, init) => {
    assert.equal(new URL(String(uri)).origin,"https://connect.oriane.xyz");
    assert.equal((init!.headers as Record<string,string>).Authorization,"Bearer unit-key");
    assert.equal(init!.redirect,"error");
    body = JSON.parse(String(init!.body));
    return Response.json({ data: { results: [row, row, {...row, id:"end",publishedAt:source.end}] },
      metadata:{pagination:{totalCount:300}} });
  });
  assert.deepEqual(body.filters.platform,{includes:["tiktok"]});
  assert.equal(Date.parse(body.filters.publishedAt.before) + 1,Date.parse(source.end!));
  assert.equal(page.returned,3);
  assert.equal(page.accepted,1);
  assert.equal(page.posts[0].viewsCount,0);
  assert.equal(page.posts[0].sourceStatus,"unverified");
  assert.equal(page.posts[0].comments[0].text,"Actual comment");
  assert.equal(page.posts[0].transcript,"Hello");
  assert.equal(page.posts[0].onScreenText,"Folding\ndesk");
  const instagram = { ...source, platform: "instagram" } as const;
  for (const [input, expected] of [[[], "empty_subset"],[null,"unavailable"]] as const) {
    const subset = await fetchQuery(instagram,"unit-key",async () => Response.json({data:{results:[{...row, platform:"instagram",popularComments:input}]}}));
    assert.equal(subset.posts[0].sourceUrl,null);
    assert.equal(subset.posts[0].commentCoverage,expected);
  }
  const empty = await fetchQuery(source,"unit-key",async () => Response.json({data:{results:[]}}));
  assert.equal(empty.returned,0);
  await assert.rejects(fetchQuery(source,"unit-key",async () => new Response("sensitive", {status:429,headers:{"Retry-After":"60"}})),
    (err: unknown) => err instanceof ProviderError && err.code === "rate_limited" && err.retryable && !!err.retryAfter);
  await assert.rejects(fetchQuery(plan.queries[0],"unit-key",async () => Response.json({data:{}})), /missing_workspace_identity/);
});

test("SQL reservations, retries, budgets, run deduplication and privacy", async () => {
  const db = new PGlite();
  try {
    await db.exec("create schema outlandish_private; create role anon; create role authenticated; create role service_role;");
    const migration = new URL("../supabase/migrations/20261122000300_oriane_collection.sql",import.meta.url);
    await db.exec(await readFile(migration,"utf8"));
    const scalar = async <T>(sql:string, args:unknown[] = []) =>
      (await db.query<{v:T}>(sql,args)).rows[0].v;
    const limited = { ...makePlan("probe",2,1,now) };
    const open = () => scalar<string>("select public.open_collection_run($1) v",[JSON.stringify(limited)]);
    const id = await open();
    assert.equal(id,await open());
    const claim = async () => {
      await db.exec("update outlandish_private.collection_gate set blocked_until='-infinity'");
      return scalar<any>("select public.claim_collection_query($1) v",[id]);
    };
    const finish = (c:any, payload:object) => scalar<boolean>(
      "select public.finish_collection_query($1,$2,$3,$4) v",[id,c.query.key,c.token,JSON.stringify(payload)]);
    const read = () => scalar<CollectionSnapshot>("select public.read_collection_run($1) v",[id]);
    const auth = await claim();
    assert.equal(auth.query.kind,"workspace");
    assert.equal((await claim()).status,"waiting");
    await finish(auth,{returned:0,accepted:0,posts:[],coverage:{authenticated:1}});
    assert.equal(await finish(auth,{returned:0,posts:[]}),false);
    const one = await claim();
    const post = {id:"provider-id",platform:"tiktok",platformId:"4",profileId:"a",frames:[{id:"f"}],comments:[{id:"c",text:"question"}],thumbnailUrl:"https://assets.invalid/thumbnail"};
    await finish(one,{returned:1,accepted:1,posts:[post],coverage:{withCommentText:1}});
    assert.equal((await claim()).status,"budget_exhausted");
    assert.equal((await read()).requests,2);
    assert.equal((await read()).posts.length,1);
    assert.equal(await scalar<string>("select count(*) v from outlandish_private.collection_comments"),1);
    assert.equal(await scalar<string>("select count(*) v from outlandish_private.collection_media"),2);
    assert.equal(await scalar<boolean>("select public.resume_collection_run($1,3) v",[id]),true);
    const ig = await claim();
    assert.equal(ig.query.platform,"instagram");
    await finish(ig,{error:"access_denied",retryable:false,retryAfter:null});
    assert.equal((await claim()).status,"partial");
    for (const role of ["anon","authenticated"]) {
      await db.exec("set role " + role);
      await assert.rejects(read(), /permission denied/);
      await assert.rejects(open(), /permission denied/);
      await db.exec("reset role");
    }
    // A 429 holds ALL workers; a prematurely repeated call cannot consume the next attempt.
    const run2 = await scalar<string>("select public.open_collection_run($1) v",[JSON.stringify(plan)]);
    const q = await scalar<any>("select public.claim_collection_query($1) v",[run2]);
    await scalar("select public.finish_collection_query($1,$2,$3,$4) v", [run2,q.query.key,q.token,
      JSON.stringify({error:"rate_limited",retryable:true,retryAfter:new Date(Date.now()+60000).toISOString()})]);
    assert.equal((await scalar<any>("select public.claim_collection_query($1) v",[run2])).status,"waiting");
  } finally { await db.close(); }
});

test("local probe authenticates once, accounts for blocked platforms and replays settled pages without network", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { probe } = await import("../scripts/collect-probe.ts");
  const directory = await mkdtemp(join(tmpdir(),"oriane-probe-test-"));
  let calls = 0;
  const fetcher: typeof fetch = async input => {
    calls++;
    if (String(input).includes("/workspace")) return Response.json({data:{id:"unit-workspace"}});
    return calls === 2 ? new Response(null,{status:403}) : Response.json({data:{results:[]}});
  };
  const options = { now, directory, fetcher, env: { ORIANE_API_KEY:"unit-key", ORIANE_PROBE_REQUEST_LIMIT:"3" } };
  try {
    const a = await probe(options);
    const b = await probe(options);
    assert.equal(a.runId,b.runId);
    assert.equal(calls,3);
    assert.deepEqual(a.queries.map(q => [q.status,q.returned]),[["done",0],["failed",null],["done",0]]);
    assert.equal(a.queries[1].reason,"access_denied");
    assert.equal(b.requests,3);
    assert.equal(JSON.stringify(b).includes("unit-workspace"),false);
    assert.equal(JSON.stringify(b).includes("unit-key"),false);
  } finally { await rm(directory,{force:true,recursive:true}); }
});

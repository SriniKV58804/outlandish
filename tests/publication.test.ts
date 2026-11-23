import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { makePlan } from "../lib/collection/plan.ts";
import type { CollectedPost, CollectionSnapshot } from "../lib/collection/types.ts";
import { analyzeDiscovery } from "../lib/discovery/analyze.ts";
import { preparePublication, sellerLeads } from "../lib/publication/prepare.ts";
import { publicWebUrl, type Review } from "../lib/publication/schema.ts";

const fixedNow = new Date("2026-11-20T18:00:00Z");
const runId = "a9c95b91-f731-4456-9a01-0b1857ee16cc";
const account = "5295c72f-9cde-459e-b3d0-a31ef7bc45dc";
const checkedAt = "2026-11-19T15:20:00Z";
const page = (url:string) => ({url, checkedAt,desktop:"visible",mobile:"visible",evidence:"Test-only destination identity evidence."} as const);

function sample() {
  const plan = makePlan("discovery",29,5,new Date("2026-11-18T09:00:00Z"));
  const queries = plan.queries.map(q=>({...q,status:"done" as const,attempts:1,returned:0,accepted:0,reason:null,nextAttemptAt:null,coverage:null}));
  const base = queries.filter(q=>q.platform==="tiktok" && q.day).sort((a,b)=>a.day!.localeCompare(b.day!));
  const posts: CollectedPost[] = [base[0],base[8],base[9]].map((query,index)=>{
    query.returned = 1; query.accepted = 1;
    const handle = "test" + index;
    const id = "12345" + index;
    return {id,platform:"tiktok",platformId:id,profileHandle:handle,profileId:handle,profilePlatformId:handle,
      publishedAt: query.start!,observedAt:checkedAt,caption:index?"Testing a folding kayak.":"Walking by the sea.",
      title:null,transcript:null,onScreenText:null,profileBio:index===2?"We make boats. Shop our collection.":null,
      thumbnailUrl:"https://assets.ori-cdn.com/qa-image",sourceUrl:`https://www.tiktok.com/@${handle}/video/${id}`,
      sourceStatus:"unverified",viewsCount:null,commentsCount:null,commentCoverage:index===1?"available":"empty_subset",
      comments:index===1?[{id:"comment1",text:"Will it fit inside my trunk?",profileId:null,likesCount:null,repliesCount:null,publishedAt:null}]:[],frames:[]};
  });
  const run: CollectionSnapshot = {...plan,mode:"live",runId,status:"complete",startedAt:checkedAt,completedAt:checkedAt,requests:29,queries,posts};
  const topic = analyzeDiscovery(run, {now:fixedNow}).ranked[0];
  assert.equal(topic.key,"folding kayak");
  const post = posts[1];
  const review: Review = {decisions:[{key:topic.key,decision:"approve",clips:[{
    postId:post.id,source:page(post.sourceUrl!),thumbnailCheckedAt:checkedAt,thumbnailUse:"approved-for-private-display",
    thumbnailBasis:"Synthetic test record.",thumbnailExpiresAt:null,selectedCommentIds:["comment1"],
  }],prospect:{brand:"Synthetic Studio",name:"Test boat",seller:"sells-product",product:page("https://test-paddler.com/products/test-boat"),
    profile:page("https://www.instagram.com/testpaddler/"),ownership:page("https://test-paddler.com/about"),
    ownershipBasis:"Synthetic cross-link proof.",sizeBasis:"Unknown in test.",fit:"Visible folding sequence answers the volume question."},
  pitch:{format:"creator-video",idea:"Fold the kayak and show whether it fits the measured trunk.",rationale:"Demonstrate the exact size asked about."},
  uncertainties:["Synthetic data for a unit test."]}]};
  return {run,review};
}

test("publication checks authentic run membership, shopping excerpts, media and reviewed destinations",()=>{
  const {run,review} = sample();
  const topic = analyzeDiscovery(run).ranked[0];
  assert.equal(sellerLeads(run,topic)[0].status,"unverified");
  const prepared = preparePublication(run,review,fixedNow);
  assert.equal(prepared.scene.opportunities[0].clips[0].comments[0].publishedAt,null);
  assert.equal(prepared.scene.opportunities[0].clips[0].embedUrl,null);
  assert.equal(prepared.scene.opportunities[0].comparisons[0].accountDelta,2);
  assert.throws(()=>preparePublication({...run,mode:"fixture"} as unknown as CollectionSnapshot,review,fixedNow),/live discovery/);
  const missing = structuredClone(review);
  const approval = missing.decisions[0];
  assert.ok(approval.decision==="approve");
  approval.clips[0].selectedCommentIds=["fabricated"];
  assert.throws(()=>preparePublication(run,missing,fixedNow),/observed text/);
  approval.clips[0].selectedCommentIds=[];
  assert.throws(()=>preparePublication(run,missing,fixedNow),/sourced shopper question/);
  approval.clips[0].source=page("https://www.tiktok.com/@test1/video/987");
  assert.throws(()=>preparePublication(run,missing,fixedNow),/exact platform post/);
  approval.clips[0].source=page(run.posts[1].sourceUrl!);
  approval.clips[0].thumbnailExpiresAt="2026-11-18T00:00:00Z";
  assert.throws(()=>preparePublication(run,missing,fixedNow),/expired/);
  const expiredRun = structuredClone(run);
  expiredRun.posts[1].thumbnailUrl += "?X-Amz-Date=20261119T000000Z&X-Amz-Expires=900";
  assert.throws(()=>preparePublication(expiredRun,review,fixedNow),/expired/);
  assert.ok(!publicWebUrl("https://shop.example.com/product"));
  assert.ok(!publicWebUrl("https://seller.com/?api_key=secret"));
  assert.throws(()=>preparePublication(run,{decisions:[]},fixedNow),/why each ranked/);
  assert.equal(preparePublication(run,{decisions:[{decision:"skip",key:topic.key,reason:"No verified product page."}]},fixedNow).scene.opportunities.length,0);
});

test("discovery SQL binds approvals to real observations, freezes corrections and gates membership",async t=>{
  const db = new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to anon,authenticated,service_role;`);
  const dir=new URL("../supabase/migrations/",import.meta.url);
  for(const file of (await readdir(dir)).sort()) if(file.endsWith(".sql")) await db.exec(await readFile(new URL(file,dir),"utf8"));
  const {run,review}=sample();
  await db.query("insert into auth.users values ($1)",[account]);
  await db.query("insert into outlandish_private.memberships values ($1,'viewer',true)",[account]);
  await db.query("insert into outlandish_private.collection_runs(id,purpose,week_start,strategy,budget,requests,status,completed_at) values($1,'discovery',$2,'test',29,29,'complete',$3)",[runId,run.weekStart,run.completedAt]);
  for (const [i,q] of run.queries.entries()) await db.query("insert into outlandish_private.collection_queries(run_id,key,priority,query,status) values($1,$2,$3,$4,'done')",[runId,q.key,i,q]);
  for(const p of run.posts){
    const key = run.queries.find(q=>q.start===p.publishedAt && q.platform===p.platform)!.key;
    await db.query("insert into outlandish_private.collection_posts values($1,$2,$3,$4,$5,$6)",[runId,p.platform,p.platformId,p.id,key,p]);
    for(const c of p.comments) await db.query("insert into outlandish_private.collection_comments values($1,$2,$3,$4,$5)",[runId,p.platform,p.platformId,c.id,c]);
  }
  const call=async (sql:string,params:unknown[]=[]) => (await db.query<{v:unknown}>(sql,params)).rows[0]?.v;
  const latest=()=>call("select public.read_latest_discovery() v");
  const draft=()=>call("select public.save_discovery_review($1,$2) v",[runId,review]);
  const save=async(r:Review)=>{
    const plan = preparePublication(run,r,fixedNow);
    const reviewId=await call("select public.save_discovery_review($1,$2) v",[runId,r]);
    await call("select public.save_discovery_analysis($1,$2,$3) v",[runId,plan.fingerprint,plan.topicRecords]);
    return {reviewId,plan};
  };
  const publish=(saved:Awaited<ReturnType<typeof save>>,expected:string|null=null,scene=saved.plan.scene) =>
    call("select public.publish_discovery_revision($1,$2,$3,$4,$5) v",[runId,saved.reviewId,expected,saved.plan.fingerprint,scene]);
  await db.exec("set role anon");
  await assert.rejects(latest,/permission denied/i);
  await db.exec("reset role;set role authenticated");
  assert.equal(await latest(),null);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[account]);
  await assert.rejects(draft,/editor access/i);
  await assert.rejects(()=>db.exec("select * from outlandish_private.discovery_reviews"),/permission denied/i);
  await db.exec("reset role");
  await db.query("update outlandish_private.memberships set role='editor' where user_id=$1",[account]);
  await db.exec("set role authenticated");
  assert.ok(await draft());
  assert.equal(await latest(),null);
  await db.exec("reset role;set role service_role");
  const first=await save(review);
  const altered=structuredClone(first.plan.scene);
  altered.opportunities[0].clips[0].comments[0].text="Invented text.";
  await assert.rejects(()=>publish(first,null,altered),/matching collected source/);
  const published=await publish(first) as {active:boolean};
  assert.equal(published.active,true);
  assert.equal((await publish(first) as {alreadyPublished:boolean}).alreadyPublished,true);
  const changed=structuredClone(review);
  assert.ok(changed.decisions[0].decision==="approve");
  changed.decisions[0].pitch.idea+=" Provide both measurements.";
  const second=await save(changed);
  await assert.rejects(()=>publish(second),/week changed/);
  await publish(second,first.plan.scene.revisionId);
  assert.equal((await publish(first) as {active:boolean}).active,false);
  await db.exec("reset role;set role authenticated");
  assert.equal((await latest() as {revisionId:string}).revisionId,second.plan.scene.revisionId);
  assert.equal((await call("select public.read_discovery_for_opportunity($1) v",[first.plan.scene.opportunities[0].id]) as {revisionId:string}).revisionId,first.plan.scene.revisionId);
  assert.equal(await call("select public.read_discovery_opportunity($1) v",["missing"]),null);
  await db.exec("reset role;update outlandish_private.memberships set active=false;set role authenticated");
  assert.equal(await latest(),null);
});

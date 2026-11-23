-- Discovery revisions are global to a week. Archive tables used by the old CSV
-- operator remain intact, but neither viewer RPC below reads them.
create table outlandish_private.discovery_topics (
  run_id uuid not null references outlandish_private.collection_runs,
  analysis_version text not null check(analysis_version ~ '^[0-9a-f]{64}$'),
  topic_key text not null,
  analysis jsonb not null,
  primary key(run_id, analysis_version, topic_key)
);
create table outlandish_private.discovery_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references outlandish_private.collection_runs,
  fingerprint bytea not null,
  document jsonb not null,
  editor_id uuid,
  reviewed_at timestamptz not null default clock_timestamp(),
  unique(run_id, fingerprint)
);
create table outlandish_private.discovery_revisions (
  id text primary key check (id ~ '^rev_[0-9a-f]{32}$'),
  run_id uuid not null references outlandish_private.collection_runs,
  review_id uuid not null references outlandish_private.discovery_reviews,
  week_start date not null,
  fingerprint text not null unique check(fingerprint ~ '^[0-9a-f]{64}$'),
  scene jsonb not null,
  published_at timestamptz not null default clock_timestamp()
);
create table outlandish_private.discovery_active_weeks (
  week_start date primary key,
  revision_id text not null references outlandish_private.discovery_revisions
);
create table outlandish_private.discovery_opportunities (
  id text primary key,
  revision_id text not null references outlandish_private.discovery_revisions,
  detail jsonb not null
);
alter table outlandish_private.discovery_topics enable row level security;
alter table outlandish_private.discovery_reviews enable row level security;
alter table outlandish_private.discovery_revisions enable row level security;
alter table outlandish_private.discovery_active_weeks enable row level security;
alter table outlandish_private.discovery_opportunities enable row level security;
revoke all on outlandish_private.discovery_topics,outlandish_private.discovery_reviews,
  outlandish_private.discovery_revisions,outlandish_private.discovery_active_weeks,
  outlandish_private.discovery_opportunities from public,anon,authenticated,service_role;

create function public.save_discovery_analysis(p_run uuid,p_version text,p_topics jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
  if jsonb_typeof(p_topics) is distinct from 'array' then raise exception 'Invalid topic list'; end if;
  for item in select value from jsonb_array_elements(p_topics) loop
    insert into outlandish_private.discovery_topics(run_id,analysis_version,topic_key,analysis)
      values(p_run,p_version,item->>'key',item)
      on conflict(run_id,analysis_version,topic_key) do nothing;
  end loop;
end $$;

create function public.save_discovery_review(p_run uuid,p_document jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare revision uuid; checksum bytea;
begin
  if current_setting('role',true) is distinct from 'service_role'
     and public.active_membership() is distinct from 'editor' then
    raise exception 'Editor access required' using errcode='42501';
  end if;
  if jsonb_typeof(p_document->'decisions') is distinct from 'array' then raise exception 'Invalid review'; end if;
  checksum:=sha256(convert_to(p_document::text,'UTF8'));
  insert into outlandish_private.discovery_reviews(run_id,fingerprint,document,editor_id)
    values(p_run,checksum,p_document,auth.uid()) on conflict(run_id,fingerprint) do nothing;
  select id into revision from outlandish_private.discovery_reviews where run_id=p_run and fingerprint=checksum;
  return revision;
end $$;

create function public.publish_discovery_revision(p_run uuid,p_review_id uuid,p_expected_revision text,p_fingerprint text,p_scene jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  run outlandish_private.collection_runs%rowtype;
  prior outlandish_private.discovery_revisions%rowtype;
  active_id text;
  review jsonb;
  decision jsonb;
  item jsonb;
  clip jsonb;
  comment jsonb;
  node jsonb;
  checks jsonb;
  post outlandish_private.collection_posts%rowtype;
  topic_document jsonb;
  revision_key text := p_scene->>'revisionId';
  day date;
  approved_count integer;
begin
  select * into strict run from outlandish_private.collection_runs where id=p_run;
  day:=run.week_start;
  if run.mode <> 'live' or run.provider <> 'oriane' or run.purpose <> 'discovery' or run.completed_at is null
     or run.status not in ('complete','partial') or not exists (
       select 1 from outlandish_private.collection_queries where run_id=p_run and query->>'kind'='workspace' and status='done'
     ) or not exists (
       select 1 from outlandish_private.collection_queries where run_id=p_run and query->>'kind'='search' and status='done'
         and (query->>'day')::date between day-7 and day+6
       group by query->>'platform' having count(distinct query->>'day')=14
     )
  then raise exception 'Expected a finished authenticated discovery run with comparable coverage'; end if;

  select document into strict review from outlandish_private.discovery_reviews where id=p_review_id and run_id=p_run;
  select count(*) into approved_count from jsonb_array_elements(review->'decisions') d where d->>'decision'='approve';
  perform outlandish_private.assert_fields(p_scene,array['mode','revisionId','weekStart','weekEnd','collectedAt','coverage','opportunities'],array['opportunities']);
  if p_scene->>'mode' is distinct from 'live' or (p_scene->>'weekStart')::date is distinct from day
     or (p_scene->>'weekEnd')::date is distinct from day+6 or
     date_trunc('milliseconds',(p_scene->>'collectedAt')::timestamptz) is distinct from date_trunc('milliseconds',run.completed_at)
     or not coalesce(p_fingerprint ~ '^[0-9a-f]{64}$',false) or revision_key is distinct from 'rev_'||left(p_fingerprint,32)
     or nullif(btrim(p_scene->>'coverage'),'') is null or jsonb_typeof(p_scene->'opportunities') is distinct from 'array'
     or jsonb_array_length(p_scene->'opportunities') <> approved_count or approved_count>3
  then raise exception 'Invalid discovery revision'; end if;
  perform pg_advisory_xact_lock(hashtextextended('outlandish.discovery.' || (day-date '2000-01-01')::text,0));
  select revision_id into active_id from outlandish_private.discovery_active_weeks where week_start=day;
  select * into prior from outlandish_private.discovery_revisions where fingerprint=p_fingerprint;
  if found then
    if prior.scene is distinct from p_scene or prior.run_id<>p_run or prior.review_id<>p_review_id then
      raise exception 'Fingerprint conflict';
    end if;
    return jsonb_build_object('revisionId',prior.id,'active',prior.id=active_id,'alreadyPublished',true,'publishedAt',prior.published_at);
  end if;
  if active_id is distinct from p_expected_revision then
    raise exception 'This week changed. Review its current revision before correcting.' using errcode='40001';
  end if;
  for item in select value from jsonb_array_elements(p_scene->'opportunities') loop
    perform outlandish_private.assert_fields(item,array['id','topic','finding','clips','prospect','pitch','statistics','comparisons','uncertainties'],array['clips','prospect','pitch','statistics','comparisons','uncertainties']);
    select d,t.analysis into decision,topic_document from jsonb_array_elements(review->'decisions') d
      join outlandish_private.discovery_topics t on t.run_id=p_run and t.analysis_version=p_fingerprint and t.topic_key=d->>'key'
      where d->>'decision'='approve' and t.analysis->>'label'=item->>'topic'
        and item->>'id'=revision_key || '_' || left(encode(sha256(convert_to(d->>'key','UTF8')),'hex'),16);
    if decision is null or topic_document->>'ranked' is distinct from 'true'
       or topic_document->'comparisons' is distinct from item->'comparisons'
       or decision->'pitch' is distinct from item->'pitch'
       or decision->'prospect'->>'seller' is distinct from 'sells-product'
       or decision->'prospect'->'product'->>'url' is distinct from item->'prospect'->>'url'
       or nullif(item->'prospect'->>'ownershipBasis','') is null
       or jsonb_typeof(item->'clips') is distinct from 'array' or jsonb_array_length(item->'clips') not between 1 and 16
       or not exists (select 1 from jsonb_array_elements(item->'clips') c where jsonb_array_length(c->'comments')>0)
    then raise exception 'Unapproved topic, comparison, product or shopper evidence'; end if;
    perform outlandish_private.assert_fields(item->'prospect',array['brand','name','url','fit','sizeBasis','profileUrl','ownershipUrl','ownershipBasis','checkedAt']);
    perform outlandish_private.assert_fields(item->'pitch',array['format','idea','rationale']);
    if exists(select 1 from jsonb_array_elements((item->'uncertainties')||(item->'statistics')) v where jsonb_typeof(v)<>'string') then
      raise exception 'Invalid evidence text'; end if;
    for node in select value from jsonb_array_elements(item->'comparisons') loop
      perform outlandish_private.assert_fields(node,array['platform','status','currentAccounts','priorAccounts',
        'currentTrackedAccounts','priorTrackedAccounts','accountDelta','shareDelta','note']);
    end loop;
    for clip in select value from jsonb_array_elements(item->'clips') loop
      perform outlandish_private.assert_fields(clip,array['id','platform','thumbnail','thumbnailExpiresAt','title','handle','publishedAt','observedAt','sourceUrl','playbackUrl','embedUrl','comments','commentCoverage'],array['comments']);
      select * into strict post from outlandish_private.collection_posts where run_id=p_run and platform=clip->>'platform' and provider_id=clip->>'id';
      select c into checks from jsonb_array_elements(decision->'clips') c where c->>'postId'=post.provider_id;
      if checks is null or checks->>'thumbnailUse' is distinct from 'approved-for-private-display'
         or nullif(checks->>'thumbnailBasis','') is null or checks->'source'->>'desktop' is distinct from 'visible' or checks->'source'->>'mobile' is distinct from 'visible'
         or nullif(checks->'source'->>'evidence','') is null
         or clip->>'sourceUrl' is distinct from checks->'source'->>'url'
         or clip->>'embedUrl' is distinct from checks->'embed'->>'url' or clip->>'playbackUrl' is not null
         or nullif(clip->>'thumbnail','') is null or clip->>'thumbnail' is distinct from post.observation->>'thumbnailUrl'
         or (clip->>'thumbnailExpiresAt')::timestamptz <= clock_timestamp()
         or not exists(select 1 from jsonb_array_elements(topic_document->'evidence') e where e->>'postId'=post.provider_id and e->>'platform'=post.platform)
      then raise exception 'Clip missing verified source, thumbnail or topic evidence'; end if;
      for comment in select value from jsonb_array_elements(clip->'comments') loop
        perform outlandish_private.assert_fields(comment,array['id','text','sourceUrl','publishedAt','observedAt','recurring']);
        if comment->>'sourceUrl' is distinct from clip->>'sourceUrl' or not (checks->'selectedCommentIds' ? (comment->>'id'))
           or not exists (select 1 from outlandish_private.collection_comments c where c.run_id=p_run and c.platform=post.platform
             and c.platform_id=post.platform_id and c.comment_id=comment->>'id' and c.observation->>'text'=comment->>'text')
        then raise exception 'Shopper excerpt has no matching collected source'; end if;
      end loop;
    end loop;
  end loop;
  insert into outlandish_private.discovery_revisions(id,run_id,review_id,week_start,fingerprint,scene)
    values(revision_key,p_run,p_review_id,day,p_fingerprint,p_scene) returning * into prior;
  insert into outlandish_private.discovery_opportunities(id,revision_id,detail)
    select o->>'id',revision_key,o from jsonb_array_elements(p_scene->'opportunities') o;
  insert into outlandish_private.discovery_active_weeks(week_start,revision_id) values(day,revision_key)
    on conflict(week_start) do update set revision_id=excluded.revision_id;
  return jsonb_build_object('revisionId',revision_key,'active',true,'alreadyPublished',false,'publishedAt',prior.published_at);
end $$;

create function public.read_latest_discovery() returns jsonb
language sql stable security definer set search_path='' as $$
  select r.scene||jsonb_build_object('publishedAt',r.published_at)
  from outlandish_private.discovery_active_weeks w join outlandish_private.discovery_revisions r on r.id=w.revision_id
  where public.active_membership() is not null order by w.week_start desc limit 1
$$;

create function public.read_discovery_opportunity(p_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select detail from outlandish_private.discovery_opportunities where id=p_id and public.active_membership() is not null
$$;

revoke all on function public.save_discovery_analysis(uuid,text,jsonb),public.save_discovery_review(uuid,jsonb),
  public.publish_discovery_revision(uuid,uuid,text,text,jsonb),public.read_latest_discovery(),public.read_discovery_opportunity(text)
  from public,anon,authenticated,service_role;
grant execute on function public.save_discovery_review(uuid,jsonb) to authenticated,service_role;
grant execute on function public.save_discovery_analysis(uuid,text,jsonb),public.publish_discovery_revision(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.read_latest_discovery(),public.read_discovery_opportunity(text) to authenticated;

create function public.read_discovery_for_opportunity(p_id text) returns jsonb
language sql stable security definer set search_path='' as $$
  select r.scene||jsonb_build_object('publishedAt',r.published_at)
  from outlandish_private.discovery_opportunities o
  join outlandish_private.discovery_revisions r on r.id=o.revision_id
  where o.id=p_id and public.active_membership() is not null
$$;
revoke all on function public.read_discovery_for_opportunity(text) from public,anon,authenticated,service_role;
grant execute on function public.read_discovery_for_opportunity(text) to authenticated;

create function public.discovery_week_revision(p_run uuid) returns text
language sql stable security definer set search_path='' as $$
  select w.revision_id from outlandish_private.collection_runs r
  join outlandish_private.discovery_active_weeks w using(week_start) where r.id=p_run
$$;
revoke all on function public.discovery_week_revision(uuid) from public,anon,authenticated,service_role;
grant execute on function public.discovery_week_revision(uuid) to service_role;

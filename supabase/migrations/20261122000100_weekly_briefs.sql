create schema if not exists outlandish_private;
revoke all on schema outlandish_private from public, anon, authenticated, service_role;

create table outlandish_private.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  active boolean not null default true
);

create table outlandish_private.brief_revisions (
  revision_id text primary key,
  category text not null,
  week_start date not null,
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  summary jsonb not null,
  audit jsonb not null check (jsonb_typeof(audit) = 'object'),
  active boolean not null,
  published_by name not null,
  published_at timestamptz not null default clock_timestamp()
);
create unique index active_revision_per_week
  on outlandish_private.brief_revisions (category, week_start) where active;
create index latest_active_revision
  on outlandish_private.brief_revisions (week_start desc, published_at desc, revision_id) where active;

create table outlandish_private.opportunities (
  opportunity_id text primary key,
  revision_id text not null references outlandish_private.brief_revisions(revision_id),
  detail jsonb not null
);

alter table outlandish_private.memberships enable row level security;
alter table outlandish_private.brief_revisions enable row level security;
alter table outlandish_private.opportunities enable row level security;
revoke all on all tables in schema outlandish_private from public, anon, authenticated, service_role;

create function public.active_membership()
returns text
language sql stable security definer set search_path = ''
as $$
  select role from outlandish_private.memberships where user_id = auth.uid() and active;
$$;

create function public.read_latest_brief()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select r.summary
  from outlandish_private.brief_revisions r
  where r.active and (select public.active_membership()) is not null
  order by r.week_start desc, r.published_at desc, r.revision_id
  limit 1;
$$;

create function public.read_opportunity(p_id text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select o.detail
  from outlandish_private.opportunities o
  where o.opportunity_id = p_id and (select public.active_membership()) is not null;
$$;

create function public.get_active_revision(p_category text, p_week_start date)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select r.summary
  from outlandish_private.brief_revisions r
  where r.active and r.category = p_category and r.week_start = p_week_start;
$$;

-- These fields make up the public DTO surface. Unexpected fields can contain
-- private notes, so reject them even when the trusted importer submits them.
create function outlandish_private.assert_fields(
  p_object jsonb, p_allowed text[], p_nested text[] default '{}'::text[]
)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if jsonb_typeof(p_object) is distinct from 'object'
    or (p_object - p_allowed) <> '{}'::jsonb
  then
    raise exception 'Published record contains unsupported fields' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(p_object)
    where jsonb_typeof(value) in ('object', 'array') and not (key = any(p_nested))
  ) then
    raise exception 'Published record contains nested fields outside its contract' using errcode = '22023';
  end if;
end;
$$;

create function public.publish_brief(p_revision jsonb, p_fingerprint text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  summary jsonb := p_revision->'summary';
  details jsonb := p_revision->'details';
  publication_audit jsonb := coalesce(p_revision->'audit', '{}'::jsonb);
  category_name text := summary->>'category';
  revision_key text := summary->>'revisionId';
  start_on date;
  prior_revision outlandish_private.brief_revisions%rowtype;
  topic_summary jsonb;
  topic_detail jsonb;
  node jsonb;
  period_fields text[] := array['weekStart','weekEnd','priorWeekStart','priorWeekEnd','timezone'];
  preview_fields text[] := array['postId','platform','imageUrl','alt','views'];
  comparison_fields text[] := array[
    'platform','status','priorAccounts','currentAccounts','priorTrackedAccounts','currentTrackedAccounts','note'
  ];
  coverage_period jsonb;
  source_posts integer;
  distinct_source_urls integer;
  comment_count integer;
  distinct_excerpts integer;
begin
  if (p_revision->'fixture') is distinct from 'false'::jsonb
    or (p_revision->'reviewed') is distinct from 'true'::jsonb
    or (summary->>'state') is distinct from 'published'
    or nullif(btrim(category_name), '') is null
    or not coalesce(revision_key ~ '^[a-zA-Z0-9_-]{1,100}$', false)
    or not coalesce(p_fingerprint ~ '^[0-9a-f]{64}$', false)
    or jsonb_typeof(summary->'opportunities') is distinct from 'array'
    or jsonb_typeof(details) is distinct from 'array'
    or jsonb_typeof(publication_audit) is distinct from 'object'
  then
    raise exception 'A reviewed, non-fixture publication is required' using errcode = '22023';
  end if;

  perform outlandish_private.assert_fields(summary, period_fields || array[
    'state','id','revisionId','category','coverageNote','opportunities'
  ], array['opportunities']);

  start_on := (summary->>'weekStart')::date;
  coverage_period := jsonb_build_object(
    'weekStart', summary->'weekStart', 'weekEnd', summary->'weekEnd',
    'priorWeekStart', summary->'priorWeekStart', 'priorWeekEnd', summary->'priorWeekEnd',
    'timezone', summary->'timezone'
  );
  if start_on is null
    or extract(isodow from start_on) <> 1
    or (summary->>'weekEnd')::date is distinct from start_on + 6
    or (summary->>'priorWeekStart')::date is distinct from start_on - 7
    or (summary->>'priorWeekEnd')::date is distinct from start_on - 1
    or (summary->>'timezone') is distinct from 'America/Los_Angeles'
    or jsonb_array_length(details) > 3
    or jsonb_array_length(details) <> jsonb_array_length(summary->'opportunities')
  then
    raise exception 'Invalid publication period or opportunity count' using errcode = '22023';
  end if;

  if (select count(distinct val->>'id') from jsonb_array_elements(details) as val) <> jsonb_array_length(details)
    or (select count(distinct val->>'id') from jsonb_array_elements(summary->'opportunities') as val)
      <> jsonb_array_length(details)
  then
    raise exception 'Opportunity IDs must be unique' using errcode = '22023';
  end if;

  for topic_summary in select value from jsonb_array_elements(summary->'opportunities') loop
    perform outlandish_private.assert_fields(
      topic_summary, array['id','topic','finding','comparison','previews'], array['comparison','previews']
    );
    select value into topic_detail
      from jsonb_array_elements(details)
      where value->>'id' = topic_summary->>'id';
    perform outlandish_private.assert_fields(topic_detail, array[
      'id','topic','finding','period','comparisons','shopperQuestion','posts','comments','product','pitch','uncertainties'
    ], array['period','comparisons','posts','comments','product','pitch','uncertainties']);
    perform outlandish_private.assert_fields(topic_summary->'comparison', comparison_fields);

    if not coalesce((topic_detail->>'id') ~ '^[a-zA-Z0-9_-]{1,160}$', false)
      or not starts_with(topic_detail->>'id', revision_key || '-')
      or topic_detail->>'topic' is distinct from topic_summary->>'topic'
      or topic_detail->>'finding' is distinct from topic_summary->>'finding'
      or topic_detail->'period' is distinct from coverage_period
      or (topic_summary->'comparison'->>'status') is distinct from 'rising'
      or (topic_summary->'comparison'->>'currentAccounts')::integer is null
      or (topic_summary->'comparison'->>'priorAccounts')::integer is null
      or (topic_summary->'comparison'->>'currentAccounts')::integer < 2
      or (topic_summary->'comparison'->>'priorAccounts')::integer < 0
      or (topic_summary->'comparison'->>'currentAccounts')::integer
        <= (topic_summary->'comparison'->>'priorAccounts')::integer
      or (topic_summary->'comparison'->>'currentTrackedAccounts')::integer
        is distinct from (topic_summary->'comparison'->>'priorTrackedAccounts')::integer
      or coalesce((topic_summary->'comparison'->>'currentTrackedAccounts')::integer, 0)
        < (topic_summary->'comparison'->>'currentAccounts')::integer
      or jsonb_typeof(topic_detail->'comparisons') is distinct from 'array'
      or not (topic_detail->'comparisons' @> jsonb_build_array(topic_summary->'comparison'))
      or jsonb_typeof(topic_detail->'posts') is distinct from 'array'
      or jsonb_typeof(topic_detail->'comments') is distinct from 'array'
      or jsonb_typeof(topic_detail->'uncertainties') is distinct from 'array'
      or jsonb_typeof(topic_summary->'previews') is distinct from 'array'
    then
      raise exception 'Opportunity lacks a consistent comparison or evidence' using errcode = '22023';
    end if;

    perform outlandish_private.assert_fields(topic_detail->'product', array[
      'brand','name','sourceUrl','checkedOn','fit','brandSourceUrl','sizeBasis'
    ]);
    perform outlandish_private.assert_fields(topic_detail->'pitch', array['format','test','rationale']);
    if not coalesce((topic_detail->'product'->>'sourceUrl') ~ '^https://[^/[:space:]]+', false)
      or nullif(btrim(topic_detail->'product'->>'brand'), '') is null
      or nullif(btrim(topic_detail->'product'->>'name'), '') is null
      or coalesce(topic_detail->'pitch'->>'format', '') not in ('creator-video', 'tiktok-live')
      or nullif(btrim(topic_detail->'pitch'->>'test'), '') is null
      or nullif(btrim(topic_detail->>'shopperQuestion'), '') is null
      or jsonb_array_length(topic_summary->'previews') > 3
      or jsonb_array_length(topic_detail->'comparisons') not between 1 and 2
    then
      raise exception 'Opportunity lacks an eligible product or test' using errcode = '22023';
    end if;

    for node in select value from jsonb_array_elements(topic_summary->'previews') loop
      perform outlandish_private.assert_fields(node, preview_fields);
      if not exists (
        select 1 from jsonb_array_elements(topic_detail->'posts') as post where post @> node
      ) then
        raise exception 'Preview does not match an included evidence post' using errcode = '22023';
      end if;
    end loop;
    for node in select value from jsonb_array_elements(topic_detail->'comparisons') loop
      perform outlandish_private.assert_fields(node, comparison_fields);
    end loop;
    for node in select value from jsonb_array_elements(topic_detail->'posts') loop
      perform outlandish_private.assert_fields(node, preview_fields || array[
        'sourceUrl','publishedAt','observedAt','note','commentAvailability'
      ]);
    end loop;
    for node in select value from jsonb_array_elements(topic_detail->'comments') loop
      perform outlandish_private.assert_fields(node, array['id','postId','excerpt','observedAt','sourceUrl']);
    end loop;
    if exists (
      select 1 from jsonb_array_elements(topic_detail->'uncertainties') as item
      where jsonb_typeof(item) <> 'string'
    ) then
      raise exception 'Opportunity uncertainties must be text' using errcode = '22023';
    end if;

    select count(distinct post->>'postId'), count(distinct post->>'sourceUrl'), count(distinct comment->>'id'),
      count(distinct lower(regexp_replace(btrim(comment->>'excerpt'), '[[:space:]]+', ' ', 'g')))
    into source_posts, distinct_source_urls, comment_count, distinct_excerpts
    from jsonb_array_elements(topic_detail->'comments') as comment
    join jsonb_array_elements(topic_detail->'posts') as post
      on post->>'postId' = comment->>'postId'
    where post->>'commentAvailability' in ('available', 'partial')
      and (post->>'sourceUrl') ~ '^https://[^/[:space:]]+'
      and nullif(btrim(comment->>'excerpt'), '') is not null;

    if source_posts < 2 or distinct_source_urls < 2 or comment_count < 2 or distinct_excerpts < 2 then
      raise exception 'A recurring question needs two linked source posts and comments' using errcode = '22023';
    end if;
  end loop;

  -- A category/week can have one active revision. Freeze the previous payload
  -- and flip the active link in the same transaction as the new inserts.
  perform pg_advisory_xact_lock(hashtextextended(category_name || E'\n' || (start_on - date '2000-01-01')::text, 0));
  select * into prior_revision from outlandish_private.brief_revisions where fingerprint = p_fingerprint;
  if found then
    if prior_revision.summary is distinct from summary or prior_revision.audit is distinct from publication_audit or exists (
      select 1
      from jsonb_array_elements(details) as detail
      left join outlandish_private.opportunities as o on o.opportunity_id = detail->>'id'
      where o.revision_id is distinct from prior_revision.revision_id or o.detail is distinct from detail
    ) then
      raise exception 'Publication fingerprint does not match its existing content' using errcode = '22023';
    end if;
    return jsonb_build_object('revisionId', prior_revision.revision_id, 'alreadyPublished', true, 'active', prior_revision.active);
  end if;

  update outlandish_private.brief_revisions
  set active = false
  where category = category_name and week_start = start_on and active;

  insert into outlandish_private.brief_revisions
    (revision_id, category, week_start, fingerprint, summary, audit, active, published_by)
  values (
    revision_key, category_name, start_on, p_fingerprint, summary, publication_audit, true,
    coalesce(nullif(current_setting('role', true), 'none'), session_user::text)::name
  );

  insert into outlandish_private.opportunities (opportunity_id, revision_id, detail)
  select value->>'id', revision_key, value from jsonb_array_elements(details);

  return jsonb_build_object('revisionId', revision_key, 'alreadyPublished', false, 'active', true);
end;
$$;

revoke execute on function outlandish_private.assert_fields(jsonb, text[], text[]) from public, anon, authenticated, service_role;
revoke execute on function public.active_membership() from public, anon, authenticated, service_role;
revoke execute on function public.read_latest_brief() from public, anon, authenticated, service_role;
revoke execute on function public.read_opportunity(text) from public, anon, authenticated, service_role;
revoke execute on function public.get_active_revision(text, date) from public, anon, authenticated, service_role;
revoke execute on function public.publish_brief(jsonb, text) from public, anon, authenticated, service_role;

grant execute on function public.active_membership() to authenticated;
grant execute on function public.read_latest_brief() to authenticated;
grant execute on function public.read_opportunity(text) to authenticated;
grant execute on function public.get_active_revision(text, date) to service_role;
grant execute on function public.publish_brief(jsonb, text) to service_role;

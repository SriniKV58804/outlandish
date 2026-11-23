create table outlandish_private.tracked_accounts (
  platform text not null check (platform in ('tiktok', 'instagram')),
  account_key text not null check (length(account_key) > 0),
  primary key (platform, account_key)
);

create table outlandish_private.account_coverage (
  category text not null,
  cohort_key text not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  platform text not null,
  account_key text not null,
  observation jsonb not null check (jsonb_typeof(observation) = 'object'),
  primary key (category, cohort_key, week_start, platform, account_key),
  foreign key (platform, account_key)
    references outlandish_private.tracked_accounts(platform, account_key)
);

create table outlandish_private.observed_posts (
  platform text not null,
  post_key text not null check (length(post_key) > 0),
  account_key text not null,
  observation jsonb not null check (jsonb_typeof(observation) = 'object'),
  primary key (platform, post_key),
  foreign key (platform, account_key)
    references outlandish_private.tracked_accounts(platform, account_key)
);
create index posts_for_tracked_account on outlandish_private.observed_posts(platform, account_key);

create table outlandish_private.observed_comments (
  platform text not null,
  post_key text not null,
  comment_key text not null check (length(comment_key) > 0),
  observation jsonb not null check (jsonb_typeof(observation) = 'object'),
  primary key (platform, post_key, comment_key),
  foreign key (platform, post_key)
    references outlandish_private.observed_posts(platform, post_key)
);

create table outlandish_private.prospects (
  category text not null,
  topic text not null,
  product_url text not null,
  observation jsonb not null check (jsonb_typeof(observation) = 'object'),
  primary key (category, topic, product_url)
);

create table outlandish_private.import_runs (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  input_counts jsonb not null,
  changed_counts jsonb not null,
  imported_at timestamptz not null default clock_timestamp()
);

alter table outlandish_private.tracked_accounts enable row level security;
alter table outlandish_private.account_coverage enable row level security;
alter table outlandish_private.observed_posts enable row level security;
alter table outlandish_private.observed_comments enable row level security;
alter table outlandish_private.prospects enable row level security;
alter table outlandish_private.import_runs enable row level security;
revoke all on all tables in schema outlandish_private from public, anon, authenticated, service_role;

create function public.import_observations(p_fingerprint text, p_batch jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  input_counts jsonb;
  changed_counts jsonb;
  changed_accounts integer;
  changed_posts integer;
  changed_comments integer;
  changed_prospects integer;
begin
  if (p_batch->'fixture') is distinct from 'false'::jsonb
    or not coalesce(p_fingerprint ~ '^[0-9a-f]{64}$', false)
    or jsonb_typeof(p_batch->'accounts') is distinct from 'array'
    or jsonb_typeof(p_batch->'posts') is distinct from 'array'
    or jsonb_typeof(p_batch->'comments') is distinct from 'array'
    or jsonb_typeof(p_batch->'prospects') is distinct from 'array'
  then
    raise exception 'A validated, non-fixture observation batch is required' using errcode = '22023';
  end if;

  -- Serialize operator imports so overlapping row sets do not interleave.
  perform pg_advisory_xact_lock(hashtextextended('outlandish.import_observations', 0));
  select r.input_counts into input_counts
  from outlandish_private.import_runs r where r.fingerprint = p_fingerprint;
  if found then
    return jsonb_build_object(
      'alreadyImported', true, 'counts', input_counts,
      'changed', jsonb_build_object('accounts', 0, 'posts', 0, 'comments', 0, 'prospects', 0)
    );
  end if;

  insert into outlandish_private.tracked_accounts(platform, account_key)
  select distinct value->>'platform', value->>'account_key' from jsonb_array_elements(p_batch->'accounts')
  on conflict (platform, account_key) do nothing;

  insert into outlandish_private.account_coverage as coverage
    (category, cohort_key, week_start, platform, account_key, observation)
  select value->>'category', value->>'cohort_key', (value->>'week_start')::date,
    value->>'platform', value->>'account_key', value
  from jsonb_array_elements(p_batch->'accounts')
  on conflict (category, cohort_key, week_start, platform, account_key)
    do update set observation = excluded.observation
    where coverage.observation is distinct from excluded.observation;
  get diagnostics changed_accounts = row_count;

  insert into outlandish_private.observed_posts as post (platform, post_key, account_key, observation)
  select value->>'platform', value->>'post_key', value->>'account_key', value
  from jsonb_array_elements(p_batch->'posts')
  on conflict (platform, post_key)
    do update set account_key = excluded.account_key, observation = excluded.observation
    where post.observation is distinct from excluded.observation;
  get diagnostics changed_posts = row_count;

  insert into outlandish_private.observed_comments as comment (platform, post_key, comment_key, observation)
  select value->>'platform', value->>'post_key', value->>'comment_key', value
  from jsonb_array_elements(p_batch->'comments')
  on conflict (platform, post_key, comment_key)
    do update set observation = excluded.observation
    where comment.observation is distinct from excluded.observation;
  get diagnostics changed_comments = row_count;

  insert into outlandish_private.prospects as prospect (category, topic, product_url, observation)
  select value->>'category', value->>'topic', value->>'product_url', value
  from jsonb_array_elements(p_batch->'prospects')
  on conflict (category, topic, product_url)
    do update set observation = excluded.observation
    where prospect.observation is distinct from excluded.observation;
  get diagnostics changed_prospects = row_count;

  input_counts := jsonb_build_object(
    'accounts', jsonb_array_length(p_batch->'accounts'),
    'posts', jsonb_array_length(p_batch->'posts'),
    'comments', jsonb_array_length(p_batch->'comments'),
    'prospects', jsonb_array_length(p_batch->'prospects')
  );
  changed_counts := jsonb_build_object(
    'accounts', changed_accounts, 'posts', changed_posts,
    'comments', changed_comments, 'prospects', changed_prospects
  );

  insert into outlandish_private.import_runs (fingerprint, input_counts, changed_counts)
  values (p_fingerprint, input_counts, changed_counts);
  return jsonb_build_object('alreadyImported', false, 'counts', input_counts, 'changed', changed_counts);
end;
$$;

create function public.get_observations(p_category text, p_cohort_key text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with selected_accounts as (
    select * from outlandish_private.account_coverage
    where category = p_category and cohort_key = p_cohort_key
  ), selected_posts as (
    select post.*
    from outlandish_private.observed_posts as post
    where exists (
      select 1 from selected_accounts a where a.platform = post.platform and a.account_key = post.account_key
    )
  )
  select jsonb_build_object(
    'fixture', false,
    'accounts', coalesce((
      select jsonb_agg(observation order by week_start, platform, account_key) from selected_accounts
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(observation order by platform, post_key) from selected_posts
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(comment.observation order by comment.platform, comment.post_key, comment.comment_key)
      from outlandish_private.observed_comments as comment
      join selected_posts as post using (platform, post_key)
    ), '[]'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(observation order by topic, product_url)
      from outlandish_private.prospects where category = p_category
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.import_observations(text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.get_observations(text, text) from public, anon, authenticated, service_role;

grant execute on function public.import_observations(text, jsonb) to service_role;
grant execute on function public.get_observations(text, text) to service_role;

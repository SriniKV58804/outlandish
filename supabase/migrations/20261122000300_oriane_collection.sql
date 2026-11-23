-- Only the collector's server identity can access these records and functions.
create table outlandish_private.collection_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'live' check (mode = 'live'),
  purpose text not null check (purpose in ('probe','discovery')),
  provider text not null default 'oriane' check (provider = 'oriane'),
  week_start date not null check (extract(isodow from week_start) = 1),
  strategy text not null,
  budget integer not null check (budget between 1 and 87),
  requests integer not null default 0 check (requests between 0 and budget),
  status text not null default 'open' check (status in ('open','complete','partial','budget_exhausted')),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique(purpose,week_start)
);
create table outlandish_private.collection_queries (
  run_id uuid not null references outlandish_private.collection_runs,
  key text not null,
  priority integer not null,
  query jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','retry','failed','done')),
  attempts integer not null default 0,
  lease uuid,
  lease_until timestamptz,
  next_attempt timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  returned integer,
  accepted integer,
  coverage jsonb,
  reason text,
  primary key (run_id,key)
);
create table outlandish_private.collection_gate (
  provider text primary key,
  blocked_until timestamptz not null
);
insert into outlandish_private.collection_gate values ('oriane','-infinity');

create table outlandish_private.collection_profiles (
  run_id uuid not null references outlandish_private.collection_runs,
  platform text not null,
  identity text not null,
  profile_id text,
  platform_id text,
  handle text,
  bio text,
  primary key(run_id,platform,identity)
);
create table outlandish_private.collection_posts (
  run_id uuid not null,
  platform text not null,
  platform_id text not null,
  provider_id text not null,
  query_key text not null,
  observation jsonb not null,
  primary key(run_id,platform,platform_id),
  foreign key(run_id,query_key) references outlandish_private.collection_queries(run_id,key)
);
create table outlandish_private.collection_comments (
  run_id uuid not null, platform text not null, platform_id text not null, comment_id text not null,
  observation jsonb not null,
  primary key(run_id,platform,platform_id,comment_id),
  foreign key(run_id,platform,platform_id) references outlandish_private.collection_posts
);
create table outlandish_private.collection_media (
  run_id uuid not null, platform text not null, platform_id text not null, media_id text not null,
  kind text not null check (kind in ('thumbnail','frame')), observation jsonb not null,
  primary key(run_id,platform,platform_id,kind,media_id),
  foreign key(run_id,platform,platform_id) references outlandish_private.collection_posts
);
alter table outlandish_private.collection_runs enable row level security;
alter table outlandish_private.collection_queries enable row level security;
alter table outlandish_private.collection_gate enable row level security;
alter table outlandish_private.collection_profiles enable row level security;
alter table outlandish_private.collection_posts enable row level security;
alter table outlandish_private.collection_comments enable row level security;
alter table outlandish_private.collection_media enable row level security;
revoke all on outlandish_private.collection_runs, outlandish_private.collection_queries,
  outlandish_private.collection_gate,outlandish_private.collection_profiles, outlandish_private.collection_posts,
  outlandish_private.collection_comments,outlandish_private.collection_media from public,anon,authenticated,service_role;

create function public.open_collection_run(p_plan jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  rid uuid;
begin
  insert into outlandish_private.collection_runs (purpose,week_start,strategy,budget)
    values(p_plan->>'purpose',(p_plan->>'weekStart')::date,p_plan->>'strategy',(p_plan->>'budget')::integer)
    on conflict(purpose,week_start) do nothing returning id into rid;
  if rid is null then
    select id into rid from outlandish_private.collection_runs
      where purpose=p_plan->>'purpose' and week_start=(p_plan->>'weekStart')::date;
    return rid;
  end if;
  insert into outlandish_private.collection_queries(run_id,key,priority,query)
    select rid,q->>'key',ordinality,q from jsonb_array_elements(p_plan->'queries') with ordinality t(q,ordinality);
  return rid;
end;
$$;

create function public.claim_collection_query(p_run uuid,p_limit integer default null,p_rows integer default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  r outlandish_private.collection_runs;
  q outlandish_private.collection_queries;
  n timestamptz := clock_timestamp();
  until_time timestamptz;
  token uuid := gen_random_uuid();
  result_status text;
begin
  select * into strict r from outlandish_private.collection_runs where id=p_run for update;
  if r.status <> 'open' then return jsonb_build_object('status',r.status); end if;
  select blocked_until into until_time from outlandish_private.collection_gate where provider='oriane' for update;
  update outlandish_private.collection_queries set status=case when attempts>=3 then 'failed' else 'retry' end,
    reason='interrupted_request', lease=null,lease_until=null,next_attempt=n
    where run_id=p_run and status='running' and lease_until<=n;
  if exists(select 1 from outlandish_private.collection_queries where run_id=p_run and status='failed' and query->>'kind'='workspace') then
    update outlandish_private.collection_queries set status='failed',reason='workspace_blocked',finished_at=n
      where run_id=p_run and status in ('queued','retry');
  end if;
  if not exists(select 1 from outlandish_private.collection_queries where run_id=p_run and status in ('queued','running','retry')) then
    result_status := case when exists(select 1 from outlandish_private.collection_queries where run_id=p_run and status='failed') then 'partial' else 'complete' end;
  elsif exists(select 1 from outlandish_private.collection_queries where run_id=p_run and status='running') then
    select min(lease_until) into until_time from outlandish_private.collection_queries where run_id=p_run and status='running';
    return jsonb_build_object('status','waiting','nextAttemptAt',until_time);
  elsif r.requests >= least(r.budget,coalesce(p_limit,r.budget)) then
    result_status := 'budget_exhausted';
    update outlandish_private.collection_queries set status='failed',reason='budget_exhausted',finished_at=n
      where run_id=p_run and status in('queued','retry');
  end if;
  if result_status is not null then
    update outlandish_private.collection_runs set status=result_status,completed_at=n where id=p_run;
    return jsonb_build_object('status',result_status);
  end if;
  if until_time>n then return jsonb_build_object('status','waiting','nextAttemptAt',until_time); end if;

  select * into q from outlandish_private.collection_queries c where run_id=p_run and status in ('queued','retry')
    and coalesce(next_attempt,n)<=n and (query->>'kind'='workspace' or exists (
      select 1 from outlandish_private.collection_queries auth where auth.run_id=p_run and auth.query->>'kind'='workspace' and auth.status='done'
    )) order by priority limit 1;
  if not found then
    select min(next_attempt) into until_time from outlandish_private.collection_queries where run_id=p_run and status='retry';
    return jsonb_build_object('status','waiting','nextAttemptAt',until_time);
  end if;
  if p_rows is not null and (q.query->>'limit')::integer>p_rows then
    return jsonb_build_object('status','approval_changed');
  end if;
  update outlandish_private.collection_queries set status='running',attempts=attempts+1,
    lease=token,lease_until=n+interval '90 seconds',started_at=coalesce(started_at,n),next_attempt=null
    where run_id=p_run and key=q.key;
  -- Reserve before I/O. An ambiguous timeout or lost worker can never refund a possibly billed request.
  update outlandish_private.collection_runs set requests=requests+1 where id=p_run;
  update outlandish_private.collection_gate set blocked_until=n+interval '250 milliseconds' where provider='oriane';
  return jsonb_build_object('status','claimed','query',q.query,'token',token,'attempt',q.attempts+1);
end;
$$;

create function public.finish_collection_query(p_run uuid,p_key text,p_token uuid,p_result jsonb) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  q outlandish_private.collection_queries;
  v jsonb;
  n timestamptz := clock_timestamp();
  next_time timestamptz;
  failure text := p_result->>'error';
begin
  perform 1 from outlandish_private.collection_runs where id=p_run for update;
  select * into strict q from outlandish_private.collection_queries where run_id=p_run and key=p_key for update;
  if q.status<>'running' or q.lease is distinct from p_token then return false; end if;
  if failure is not null then
    next_time := greatest(n+make_interval(secs => (2 ^ q.attempts)::integer),(p_result->>'retryAfter')::timestamptz);
    if failure='rate_limited' or (p_result->>'retryAfter') is not null then
      update outlandish_private.collection_gate set blocked_until=greatest(blocked_until,next_time) where provider='oriane';
    end if;
    update outlandish_private.collection_queries set status=case when (p_result->>'retryable')::boolean and attempts<3 then 'retry' else 'failed' end,
      lease=null,lease_until=null,reason=failure,finished_at=n,next_attempt=next_time where run_id=p_run and key=p_key;
    if failure in ('invalid_key','provider_quota') or (q.query->>'kind'='search' and failure='access_denied') then
      update outlandish_private.collection_queries set status='failed',reason=failure,finished_at=n where run_id=p_run
        and status in ('queued','retry') and (failure<>'access_denied' or query->>'platform'=q.query->>'platform');
    end if;
    return true;
  end if;
  for v in select value from jsonb_array_elements(p_result->'posts') loop
    if coalesce(v->>'profileId',v->>'profilePlatformId',v->>'profileHandle') is not null then
      insert into outlandish_private.collection_profiles values (p_run,v->>'platform',
        coalesce(v->>'profileId',v->>'profilePlatformId',v->>'profileHandle'),v->>'profileId',v->>'profilePlatformId',v->>'profileHandle',v->>'profileBio')
        on conflict do nothing;
    end if;
    insert into outlandish_private.collection_posts values(p_run,v->>'platform',v->>'platformId',v->>'id',p_key,v)
      on conflict do nothing;
    if not found then continue; end if;
    insert into outlandish_private.collection_comments select p_run,v->>'platform',v->>'platformId',c->>'id',c from jsonb_array_elements(v->'comments') c
      on conflict do nothing;
    insert into outlandish_private.collection_media select p_run,v->>'platform',v->>'platformId',f->>'id','frame',f from jsonb_array_elements(v->'frames') f
      on conflict do nothing;
    if v->>'thumbnailUrl' is not null then
      insert into outlandish_private.collection_media values(p_run,v->>'platform',v->>'platformId','preview','thumbnail',
        jsonb_build_object('url',v->>'thumbnailUrl','expiresAt',null)) on conflict do nothing;
    end if;
  end loop;
  update outlandish_private.collection_queries set status='done',reason=null,lease=null,lease_until=null,next_attempt=null,finished_at=n,
    returned=(p_result->>'returned')::integer,accepted=(p_result->>'accepted')::integer,coverage=p_result->'coverage'
    where run_id=p_run and key=p_key;
  return true;
end;
$$;

create function public.read_collection_run(p_run uuid,p_include_posts boolean default true) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('runId',r.id,'weekStart',r.week_start,'mode',r.mode,'purpose',r.purpose,'status',r.status,
    'strategy',r.strategy,'budget',r.budget,'requests',r.requests,'startedAt',r.started_at,'completedAt',r.completed_at,
    'queries',coalesce((select jsonb_agg(c.query || jsonb_build_object('status',c.status,'attempts',c.attempts,'returned',c.returned,
      'accepted',c.accepted,'coverage',c.coverage,'reason',c.reason,'nextAttemptAt',c.next_attempt,'startedAt',c.started_at,'finishedAt',c.finished_at)
      order by c.priority) from outlandish_private.collection_queries c where c.run_id=r.id),'[]'),
    'posts',case when p_include_posts then coalesce((select jsonb_agg(p.observation order by p.platform,p.platform_id)
      from outlandish_private.collection_posts p where p.run_id=r.id),'[]'::jsonb) else '[]'::jsonb end)
  from outlandish_private.collection_runs r where r.id=p_run;
$$;

revoke all on function public.open_collection_run(jsonb),public.claim_collection_query(uuid,integer,integer),public.finish_collection_query(uuid,text,uuid,jsonb),
  public.read_collection_run(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.open_collection_run(jsonb),public.claim_collection_query(uuid,integer,integer),public.finish_collection_query(uuid,text,uuid,jsonb),
  public.read_collection_run(uuid,boolean) to service_role;

-- Explicit operator recovery preserves completed pages and the lifetime spend counter.
create function public.resume_collection_run(p_run uuid,p_budget integer) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  r outlandish_private.collection_runs;
  reopened integer;
begin
  select * into strict r from outlandish_private.collection_runs where id=p_run for update;
  if r.status not in ('partial','budget_exhausted') or p_budget<r.budget or p_budget<=r.requests
    or p_budget>(case when r.purpose='probe' then 9 else 87 end) then return false; end if;
  update outlandish_private.collection_queries set status='retry',next_attempt=greatest(coalesce(next_attempt,clock_timestamp()),clock_timestamp()),
    reason=null,finished_at=null where run_id=p_run and status='failed' and attempts<3;
  get diagnostics reopened = row_count;
  if reopened=0 then return false; end if;
  update outlandish_private.collection_runs set status='open',completed_at=null,budget=p_budget where id=p_run;
  return true;
end;
$$;
revoke all on function public.resume_collection_run(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.resume_collection_run(uuid,integer) to service_role;

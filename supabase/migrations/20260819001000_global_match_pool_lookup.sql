create or replace function public.get_or_create_global_match_pool()
returns table (
  id uuid,
  slug text,
  pool_type text,
  name text,
  source_id uuid,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('partyup-global-match-pool'));

  select
    p.id,
    p.slug,
    p.pool_type,
    p.name,
    p.source_id,
    p.status,
    p.expires_at
  into
    id,
    slug,
    pool_type,
    name,
    source_id,
    status,
    expires_at
  from public.match_pools p
  where p.slug = 'global'
    and p.status = 'active'
    and (p.expires_at is null or p.expires_at > now())
  order by p.id asc
  limit 1;

  if id is not null then
    return next;
    return;
  end if;

  select
    p.id,
    p.slug,
    p.pool_type,
    p.name,
    p.source_id,
    p.status,
    p.expires_at
  into
    id,
    slug,
    pool_type,
    name,
    source_id,
    status,
    expires_at
  from public.match_pools p
  where p.slug = 'global'
  order by p.id asc
  limit 1;

  if id is not null then
    v_pool_id := id;

    update public.match_pools p
    set pool_type = coalesce(nullif(p.pool_type, ''), 'global'),
        name = coalesce(nullif(p.name, ''), 'Global Match'),
        source_id = null,
        status = 'active',
        expires_at = null
    where p.id = v_pool_id
    returning
      p.id,
      p.slug,
      p.pool_type,
      p.name,
      p.source_id,
      p.status,
      p.expires_at
    into
      id,
      slug,
      pool_type,
      name,
      source_id,
      status,
      expires_at;

    return next;
    return;
  end if;

  insert into public.match_pools (
    slug,
    pool_type,
    name,
    source_id,
    status,
    expires_at
  )
  values (
    'global',
    'global',
    'Global Match',
    null,
    'active',
    null
  )
  returning
    match_pools.id,
    match_pools.slug,
    match_pools.pool_type,
    match_pools.name,
    match_pools.source_id,
    match_pools.status,
    match_pools.expires_at
  into
    id,
    slug,
    pool_type,
    name,
    source_id,
    status,
    expires_at;

  return next;
end;
$$;

grant execute on function public.get_or_create_global_match_pool() to anon, authenticated;

notify pgrst, 'reload schema';

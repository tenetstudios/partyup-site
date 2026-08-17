create or replace function public.get_match_pool_for_match(p_pool_id uuid)
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
begin
  return query
  select
    p.id,
    p.slug,
    p.pool_type,
    p.name,
    p.source_id,
    p.status,
    p.expires_at
  from public.match_pools p
  where p.id = p_pool_id
    and p.status = 'active'
    and (p.expires_at is null or p.expires_at > now())
    and (
      p.pool_type <> 'event'
      or exists (
        select 1
        from public.event_rooms r
        where r.id = p.source_id
      )
    )
  limit 1;
end;
$$;

grant execute on function public.get_match_pool_for_match(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

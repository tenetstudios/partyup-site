-- Let account users hide stale Activity notifications without deleting the
-- underlying notification record or its push-delivery relationship.

alter table public.notifications
  add column if not exists dismissed_at timestamptz null;

create index if not exists notifications_user_visible_created_idx
  on public.notifications(user_id, created_at desc)
  where dismissed_at is null;

create or replace function public.dismiss_my_notification(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.notifications
  set dismissed_at = coalesce(dismissed_at, now())
  where id = p_notification_id
    and user_id = auth.uid();

  return found;
end;
$$;

revoke all on function public.dismiss_my_notification(uuid) from public, anon, authenticated;
grant execute on function public.dismiss_my_notification(uuid) to authenticated;

notify pgrst, 'reload schema';

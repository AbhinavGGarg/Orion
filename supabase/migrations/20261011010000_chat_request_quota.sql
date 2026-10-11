create table public.chat_request_quota (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started timestamptz not null,
  requests integer not null
);

alter table public.chat_request_quota enable row level security;
revoke all on public.chat_request_quota from anon, authenticated;

create function public.reserve_chat_request() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  reserved uuid;
begin
  if caller is null then return false; end if;
  insert into public.chat_request_quota as quota (user_id, window_started, requests)
  values (caller, now(), 1)
  on conflict (user_id) do update set
    requests = case when quota.window_started <= now() - interval '1 minute' then 1 else quota.requests + 1 end,
    window_started = case when quota.window_started <= now() - interval '1 minute' then now() else quota.window_started end
  where quota.window_started <= now() - interval '1 minute' or quota.requests < 6
  returning user_id into reserved;
  return reserved is not null;
end;
$$;

revoke all on function public.reserve_chat_request() from public, anon;
grant execute on function public.reserve_chat_request() to authenticated;

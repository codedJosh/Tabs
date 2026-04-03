create table if not exists public.jade_workspaces (
  id text primary key,
  state jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists jade_workspaces_updated_at_idx
  on public.jade_workspaces (updated_at desc);

alter table public.jade_workspaces enable row level security;

drop policy if exists "jade_workspaces_no_direct_access" on public.jade_workspaces;
create policy "jade_workspaces_no_direct_access"
  on public.jade_workspaces
  for all
  using (false)
  with check (false);

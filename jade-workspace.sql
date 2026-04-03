-- supabase/jade-workspace.sql
-- Run this once in the Supabase SQL Editor to set up the JADE workspace table.

-- 1. Create the workspaces table
create table if not exists jade_workspaces (
  workspace_id text primary key,
  data         jsonb        not null default '{}'::jsonb,
  updated_at   timestamptz  not null default now()
);

-- 2. Index on updated_at for any future audit queries
create index if not exists jade_workspaces_updated_at_idx
  on jade_workspaces (updated_at desc);

-- 3. Row-Level Security — the service role key bypasses RLS,
--    but we lock down anon/public access anyway.
alter table jade_workspaces enable row level security;

-- Deny everything to the anon role (all access goes through the Vercel function
-- which uses the service role key)
create policy "deny_anon_select" on jade_workspaces
  for select to anon using (false);

create policy "deny_anon_insert" on jade_workspaces
  for insert to anon with check (false);

create policy "deny_anon_update" on jade_workspaces
  for update to anon using (false);

create policy "deny_anon_delete" on jade_workspaces
  for delete to anon using (false);

-- 4. Grant the service_role full access (it already has it, but explicit is safer)
grant all on jade_workspaces to service_role;

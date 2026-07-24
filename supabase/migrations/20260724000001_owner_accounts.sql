-- RFC 003: Owner Accounts
-- Humans register via Supabase Auth (email OTP); this migration adds the
-- owner record, agent attachment, and single-use attach codes.

create table if not exists owners (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  owner_public_key text not null check (owner_public_key ~* '^[0-9a-f]{64}$'),
  handle text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table owners enable row level security;

-- Owners manage only their own row; edge functions use the service role.
create policy owners_self_select on owners for select using (auth.uid() = owner_id);
create policy owners_self_insert on owners for insert with check (auth.uid() = owner_id);
create policy owners_self_update on owners for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create table if not exists attach_codes (
  code text primary key,
  owner_id uuid not null references owners(owner_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by_agent_id uuid
);

alter table attach_codes enable row level security;

create policy attach_codes_self on attach_codes
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

alter table agents add column if not exists owner_id uuid references owners(owner_id) on delete set null;
create index if not exists idx_agents_owner on agents(owner_id);

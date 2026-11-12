-- RFC 008 (trace context): the originating request a message belongs to, and the
-- sender's unit of work that caused it. Both are optional and signed by the sender.
-- Apply BEFORE deploying the oacp function that writes them.
alter table public.messages
  add column if not exists trace_id text
    check (trace_id is null or trace_id ~ '^[0-9a-f]{32}$'),
  add column if not exists trace_parent_id text
    check (trace_parent_id is null or trace_parent_id ~ '^[A-Za-z0-9_-]{1,64}$');

-- Partial: almost every existing row has no trace.
create index if not exists messages_trace_id_idx
  on public.messages (trace_id, created_at)
  where trace_id is not null;

create table if not exists lottery_kv (
  id text primary key,
  data jsonb not null,
  version integer not null default 0
);

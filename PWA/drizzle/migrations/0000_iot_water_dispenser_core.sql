-- Tables
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  name text not null default 'Water Dispenser',
  device_token text not null unique default replace(gen_random_uuid()::text,'-',''),
  tank_height_in numeric,
  measured_height_in numeric,
  sensor_offset_in numeric not null default 0,
  low_level_pct numeric not null default 10,
  total_liters_reset_at timestamptz,
  last_seen timestamptz,
  firmware_version text,
  created_at timestamptz not null default now()
);

create table public.readings (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  level_pct numeric,
  level_in numeric,
  temp_c numeric,
  flow_lpm numeric,
  total_liters numeric,
  created_at timestamptz not null default now()
);
create index readings_device_time_idx on public.readings (device_id, created_at desc);

create table public.alerts (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  type text not null,
  message text not null,
  level_pct numeric,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);
create index alerts_device_time_idx on public.alerts (device_id, created_at desc);

create table public.device_commands (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  command text not null,
  payload jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  executed_at timestamptz
);
create index device_commands_pending_idx on public.device_commands (device_id, status) where status = 'pending';

create table public.setup_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  measured_height_in numeric,
  status text not null default 'active',
  expires_at timestamptz not null default now() + interval '2 minutes',
  created_at timestamptz not null default now()
);

-- Grants
grant select, insert, update on public.devices to authenticated;
grant select on public.readings to authenticated;
grant select, update on public.alerts to authenticated;
grant select, insert on public.device_commands to authenticated;
grant select, insert, update on public.setup_sessions to authenticated;
grant all on public.devices, public.readings, public.alerts, public.device_commands, public.setup_sessions to service_role;
revoke select (device_token) on public.devices from anon, authenticated;

-- RLS
alter table public.devices enable row level security;
alter table public.readings enable row level security;
alter table public.alerts enable row level security;
alter table public.device_commands enable row level security;
alter table public.setup_sessions enable row level security;

create policy "owner reads own device" on public.devices for select to authenticated using (owner_id = auth.uid());
create policy "owner updates own device" on public.devices for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner inserts device" on public.devices for insert to authenticated with check (owner_id = auth.uid());

create policy "owner reads readings" on public.readings for select to authenticated
  using (exists (select 1 from public.devices d where d.id = readings.device_id and d.owner_id = auth.uid()));

create policy "owner reads alerts" on public.alerts for select to authenticated
  using (exists (select 1 from public.devices d where d.id = alerts.device_id and d.owner_id = auth.uid()));
create policy "owner updates alerts" on public.alerts for update to authenticated
  using (exists (select 1 from public.devices d where d.id = alerts.device_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.devices d where d.id = alerts.device_id and d.owner_id = auth.uid()));

create policy "owner inserts commands" on public.device_commands for insert to authenticated
  with check (exists (select 1 from public.devices d where d.id = device_commands.device_id and d.owner_id = auth.uid()));
create policy "owner reads commands" on public.device_commands for select to authenticated
  using (exists (select 1 from public.devices d where d.id = device_commands.device_id and d.owner_id = auth.uid()));

create policy "owner manages setup sessions" on public.setup_sessions for all to authenticated
  using (exists (select 1 from public.devices d where d.id = setup_sessions.device_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.devices d where d.id = setup_sessions.device_id and d.owner_id = auth.uid()));

-- Realtime
alter table public.readings replica identity full;
alter table public.devices replica identity full;
alter table public.alerts replica identity full;
alter table public.setup_sessions replica identity full;
alter table public.device_commands replica identity full;
alter publication supabase_realtime add table public.readings;
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.alerts;
alter publication supabase_realtime add table public.setup_sessions;
alter publication supabase_realtime add table public.device_commands;

-- Device-facing RPCs (anon + device_token)
create or replace function public.ingest_reading(
  p_device_id uuid, p_device_token text, p_level_pct numeric, p_level_in numeric,
  p_temp_c numeric, p_flow_lpm numeric, p_total_liters numeric, p_firmware text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_prev numeric;
begin
  if not exists (select 1 from public.devices where id = p_device_id and device_token = p_device_token) then
    raise exception 'invalid device token';
  end if;
  select total_liters into v_prev from public.readings where device_id = p_device_id order by id desc limit 1;
  insert into public.readings (device_id, level_pct, level_in, temp_c, flow_lpm, total_liters)
  values (p_device_id, p_level_pct, p_level_in, p_temp_c, p_flow_lpm, p_total_liters);
  update public.devices
     set last_seen = now(),
         firmware_version = coalesce(p_firmware, firmware_version),
         total_liters_reset_at = case when v_prev is not null and p_total_liters < v_prev then now() else total_liters_reset_at end
   where id = p_device_id;
end; $$;
grant execute on function public.ingest_reading(uuid,text,numeric,numeric,numeric,numeric,numeric,text) to anon;

create or replace function public.fetch_pending_commands(p_device_id uuid, p_device_token text)
returns setof public.device_commands language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.devices where id = p_device_id and device_token = p_device_token) then
    raise exception 'invalid device token';
  end if;
  update public.device_commands set status = 'expired'
   where device_id = p_device_id and status = 'pending' and expires_at < now();
  return query select * from public.device_commands
    where device_id = p_device_id and status = 'pending' order by created_at asc limit 10;
end; $$;
grant execute on function public.fetch_pending_commands(uuid,text) to anon;

create or replace function public.ack_command(p_command_id bigint, p_device_id uuid, p_device_token text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.devices where id = p_device_id and device_token = p_device_token) then
    raise exception 'invalid device token';
  end if;
  update public.device_commands set status = p_status, executed_at = now()
   where id = p_command_id and device_id = p_device_id;
end; $$;
grant execute on function public.ack_command(bigint,uuid,text,text) to anon;

create or replace function public.publish_setup_reading(p_device_id uuid, p_device_token text, p_setup_id uuid, p_height_in numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.devices where id = p_device_id and device_token = p_device_token) then
    raise exception 'invalid device token';
  end if;
  update public.setup_sessions set measured_height_in = p_height_in
   where id = p_setup_id and device_id = p_device_id and status = 'active';
  update public.devices set last_seen = now(), measured_height_in = p_height_in where id = p_device_id;
end; $$;
grant execute on function public.publish_setup_reading(uuid,text,uuid,numeric) to anon;

create or replace function public.get_device_config(p_device_id uuid, p_device_token text)
returns table (tank_height_in numeric, sensor_offset_in numeric, low_level_pct numeric)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.devices where id = p_device_id and device_token = p_device_token) then
    raise exception 'invalid device token';
  end if;
  return query select d.tank_height_in, d.sensor_offset_in, d.low_level_pct from public.devices d where d.id = p_device_id;
end; $$;
grant execute on function public.get_device_config(uuid,text) to anon;

create or replace function public.confirm_counter_reset(p_device_id uuid, p_device_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.devices where id = p_device_id and device_token = p_device_token) then
    raise exception 'invalid device token';
  end if;
  update public.devices set total_liters_reset_at = now() where id = p_device_id;
end; $$;
grant execute on function public.confirm_counter_reset(uuid,text) to anon;

-- Pairing: claim an unowned device (or create one) and reveal the token once
create or replace function public.pair_device(p_device_id uuid, p_name text default null)
returns table (id uuid, device_token text)
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select owner_id into v_owner from public.devices d where d.id = p_device_id;
  if v_owner is null and exists (select 1 from public.devices d where d.id = p_device_id) then
    update public.devices d set owner_id = auth.uid(), name = coalesce(p_name, d.name) where d.id = p_device_id;
  elsif v_owner is null then
    insert into public.devices (id, owner_id, name) values (p_device_id, auth.uid(), coalesce(p_name, 'Water Dispenser'));
  elsif v_owner <> auth.uid() then
    raise exception 'device already paired';
  end if;
  return query select d.id, d.device_token from public.devices d where d.id = p_device_id;
end; $$;
grant execute on function public.pair_device(uuid,text) to authenticated;

create or replace function public.get_device_token(p_device_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  select device_token into v_token from public.devices where id = p_device_id and owner_id = auth.uid();
  if v_token is null then raise exception 'not found'; end if;
  return v_token;
end; $$;
grant execute on function public.get_device_token(uuid) to authenticated;

-- Low-water alert trigger
create or replace function public.check_low_water() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_threshold numeric; v_prev numeric;
begin
  select low_level_pct into v_threshold from public.devices where id = new.device_id;
  if new.level_pct is null or v_threshold is null then return new; end if;
  select level_pct into v_prev from public.readings
   where device_id = new.device_id and id < new.id order by id desc limit 1;
  if new.level_pct < v_threshold and (v_prev is null or v_prev >= v_threshold) then
    insert into public.alerts (device_id, type, message, level_pct)
    values (new.device_id, 'low_water', 'Water level dropped below ' || v_threshold || '%', new.level_pct);
  end if;
  return new;
end; $$;
create trigger trg_check_low_water after insert on public.readings
for each row execute function public.check_low_water();

-- Status view
create view public.device_status
with (security_invoker = true) as
select d.id, d.name, d.owner_id, d.tank_height_in, d.low_level_pct,
  d.total_liters_reset_at, d.last_seen, d.firmware_version,
  case when d.last_seen is null then 'never'
       when now() - d.last_seen < interval '60 seconds' then 'online'
       else 'offline' end as status
from public.devices d;
grant select on public.device_status to authenticated;

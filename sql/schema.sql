-- Colsein — esquema de Supabase para 'usuarios' y 'tickets' (SIN auth real)
-- Ejecutar completo en el SQL Editor de Supabase (Project > SQL Editor > New query).
--
-- Esta versión no usa Supabase Auth: el login es solo los dos botones de
-- "acceso rápido", que asignan un usuario demo fijo. Si tu proyecto ya tenía
-- la versión con Auth real (auth.users / RLS con auth.uid()), este script
-- empieza borrando esas tablas para dejar todo limpio — es una BD de
-- prueba, así que se asume que no hay datos que conservar.

drop table if exists public.tickets cascade;
drop table if exists public.usuarios cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_admin() cascade;

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- usuarios
-- ─────────────────────────────────────────────────────────────
create table public.usuarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text not null unique,
  rol text not null check (rol in ('cliente', 'admin')),
  division_key text check (division_key in ('logica', 'instrumentacion', 'potencia', 'sensorica')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- tickets  (usuario_id -> usuarios.id)
-- ─────────────────────────────────────────────────────────────
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  equipo text not null,
  sintomas text,
  division_key text not null check (division_key in ('logica', 'instrumentacion', 'potencia', 'sensorica')),
  status text not null default 'Pendiente' check (status in ('Pendiente', 'Asignado', 'En Calibración', 'Resuelto')),
  priority text not null default 'Media' check (priority in ('Alta', 'Media', 'Baja')),
  tipo text not null default 'Falla' check (tipo in ('Falla', 'Calibración', 'Mantenimiento', 'Consulta')),
  ai_clasificado boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_usuario_id_idx on public.tickets(usuario_id);
create index tickets_status_idx on public.tickets(status);
create index tickets_division_key_idx on public.tickets(division_key);

-- keep updated_at current on every UPDATE
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at
before update on public.tickets
for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Row Level Security — permisiva a propósito: no hay login real, todo pasa
-- por el cliente anon con los dos botones de acceso rápido.
-- ─────────────────────────────────────────────────────────────
alter table public.usuarios enable row level security;
alter table public.tickets enable row level security;

create policy "usuarios_select_all" on public.usuarios for select using (true);
create policy "tickets_select_all" on public.tickets for select using (true);
create policy "tickets_insert_all" on public.tickets for insert with check (true);
create policy "tickets_update_all" on public.tickets for update using (true);

-- ─────────────────────────────────────────────────────────────
-- Realtime — necesario para que el dashboard de Admin reciba cambios en vivo
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Usuarios demo de "acceso rápido" (coinciden con DEMO_CLIENT_ID /
-- DEMO_ADMIN_ID en src/App.jsx).
-- ─────────────────────────────────────────────────────────────
insert into public.usuarios (id, nombre, email, rol)
values
  ('00000000-0000-4000-8000-000000000001', 'Ing. Carlos', 'carlos@colsein.com', 'cliente'),
  ('00000000-0000-4000-8000-000000000002', 'Ing. Colsein', 'soporte@colsein.com', 'admin');

-- ─────────────────────────────────────────────────────────────
-- (Opcional) tickets de ejemplo para ver el dashboard poblado de inmediato
-- ─────────────────────────────────────────────────────────────
insert into public.tickets (usuario_id, equipo, sintomas, division_key, status, priority, tipo, ai_clasificado)
values
  ('00000000-0000-4000-8000-000000000001', 'Sensor de presión línea 2', 'Lecturas intermitentes desde ayer en la tarde.', 'sensorica', 'En Calibración', 'Media', 'Calibración', true),
  ('00000000-0000-4000-8000-000000000001', 'PLC línea de empaque', 'El programa se detiene de forma aleatoria.', 'logica', 'Resuelto', 'Alta', 'Falla', true),
  ('00000000-0000-4000-8000-000000000001', 'Transmisor de flujo', 'Valor fuera de rango en arranque.', 'instrumentacion', 'Pendiente', 'Baja', 'Falla', false),
  ('00000000-0000-4000-8000-000000000001', 'Motor bomba línea 1', 'Motor detenido, parada total de línea.', 'potencia', 'Asignado', 'Alta', 'Falla', true);

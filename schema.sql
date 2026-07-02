-- =========================================================================
-- SISTEMA DE REPASSE DE CARGA — SCHEMA SUPABASE (PostgreSQL)
-- =========================================================================
-- Este schema modela 3 entidades centrais:
--   1. profiles   -> quem é cada usuário (papel, status ativo/inativo)
--   2. cargas     -> cada repasse de carga, quem enviou e quem recebeu
--   3. (status vem embutido em cargas.status, não precisa de tabela própria
--      porque só existem 2 estados hoje; ver nota no final para expandir)
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. PROFILES
-- -------------------------------------------------------------------------
-- Estende auth.users (gerenciado pelo Supabase Auth) com dados do negócio.
-- Todo login passa pelo Supabase Auth; esta tabela guarda o "papel" de cada
-- pessoa dentro do sistema.

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        text not null check (role in ('passador', 'programador', 'admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Usuários do sistema: passadores, programadores e admins';
comment on column public.profiles.role is 'passador = repassa carga | programador = recebe e processa | admin = gerencia equipe';

-- -------------------------------------------------------------------------
-- 2. CARGAS
-- -------------------------------------------------------------------------
-- Cada linha é um repasse de carga. Guarda quem enviou (passador_id) e
-- para quem foi delegado (programador_id) — essa dupla FK é o coração do
-- relacionamento pedido no briefing.

create table public.cargas (
  id              bigint generated always as identity primary key,

  -- dados do formulário de repasse
  route_number    text not null,
  driver_name     text not null,
  load_date       date not null,
  has_schedule    boolean not null default false,
  schedule_at     timestamptz,               -- só preenchido se has_schedule = true
  observations    text,

  -- relacionamento: quem enviou -> quem recebeu
  passador_id     uuid not null references public.profiles(id),
  programador_id  uuid not null references public.profiles(id),

  -- status do fluxo
  status          text not null default 'pendente'
                    check (status in ('pendente', 'concluida')),

  created_at      timestamptz not null default now(),
  completed_at    timestamptz,               -- preenchido quando o programador clica "OK"

  -- regra de negócio: se marcou agendamento, a data/hora é obrigatória
  constraint schedule_requires_datetime
    check (has_schedule = false or schedule_at is not null)
);

comment on table public.cargas is 'Cada repasse de carga: origem (passador), destino (programador) e status';
comment on column public.cargas.passador_id is 'Quem enviou a carga (FK -> profiles)';
comment on column public.cargas.programador_id is 'Para quem foi delegada a carga (FK -> profiles)';

-- índices para as telas de fila de trabalho / acompanhamento / histórico
create index idx_cargas_programador_status on public.cargas (programador_id, status);
create index idx_cargas_passador on public.cargas (passador_id);
create index idx_cargas_load_date on public.cargas (load_date);
create index idx_cargas_created_at on public.cargas (created_at desc);

-- -------------------------------------------------------------------------
-- 3. TRIGGER: preencher completed_at automaticamente
-- -------------------------------------------------------------------------
create or replace function public.set_completed_at()
returns trigger as $$
begin
  if new.status = 'concluida' and old.status = 'pendente' then
    new.completed_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_set_completed_at
before update on public.cargas
for each row execute function public.set_completed_at();

-- -------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- -------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.cargas   enable row level security;

-- Helper: pega o papel do usuário logado
create or replace function public.current_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;

-- PROFILES: todo mundo autenticado pode ler (precisa para os dropdowns),
-- só admin pode escrever.
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_insert_admin"
  on public.profiles for insert
  to authenticated
  with check (public.current_role() = 'admin');

create policy "profiles_update_admin_or_self"
  on public.profiles for update
  to authenticated
  using (public.current_role() = 'admin' or id = auth.uid());

create policy "profiles_delete_admin"
  on public.profiles for delete
  to authenticated
  using (public.current_role() = 'admin');

-- CARGAS:
-- passador vê/insere só as próprias; programador vê/atualiza só as suas;
-- admin vê e mexe em tudo.
create policy "cargas_select_own_or_admin"
  on public.cargas for select
  to authenticated
  using (
    passador_id = auth.uid()
    or programador_id = auth.uid()
    or public.current_role() = 'admin'
  );

create policy "cargas_insert_passador"
  on public.cargas for insert
  to authenticated
  with check (
    passador_id = auth.uid()
    and public.current_role() in ('passador', 'admin')
  );

create policy "cargas_update_programador_or_admin"
  on public.cargas for update
  to authenticated
  using (
    programador_id = auth.uid()
    or public.current_role() = 'admin'
  );

create policy "cargas_delete_admin"
  on public.cargas for delete
  to authenticated
  using (public.current_role() = 'admin');

-- -------------------------------------------------------------------------
-- 5. SEED — equipe inicial
-- -------------------------------------------------------------------------
-- IMPORTANTE: o Supabase Auth não permite inserir direto em auth.users via
-- SQL comum (é uma tabela gerenciada). Para popular a equipe inicial, use
-- UMA das duas opções abaixo:
--
--  Opção A (recomendada para começar rápido):
--    No painel do Supabase > Authentication > Users > "Add user",
--    crie os 10 usuários abaixo com e-mail + senha temporária.
--    Depois rode o INSERT em profiles casando pelo email.
--
--  Opção B (produção):
--    Use a tela de Admin do próprio app (ela chama supabase.auth.signUp
--    para criar o login e insere o profile na sequência — já implementado
--    no App.jsx).
--
-- Exemplo de INSERT em profiles depois que os auth.users existirem:
--
-- insert into public.profiles (id, full_name, role, active)
-- select u.id, v.full_name, v.role, true
-- from (values
--   ('abimael@empresa.com',        'Abimael',          'passador'),
--   ('guilherme@empresa.com',      'Guilherme',        'passador'),
--   ('kaue@empresa.com',           'Kauê',             'passador'),
--   ('luizsalomao@empresa.com',    'Luiz Salomão',     'passador'),
--   ('fatima@empresa.com',         'Fátima',           'passador'),
--   ('andreyperes@empresa.com',    'Andrey Peres',     'programador'),
--   ('juliocesar@empresa.com',     'Júlio Césa­r',       'programador'),
--   ('ane@empresa.com',            'Ane',              'programador'),
--   ('susane@empresa.com',         'Susane',           'programador'),
--   ('admin@empresa.com',          'Administrador',    'admin')
-- ) as v(email, full_name, role)
-- join auth.users u on u.email = v.email;

-- -------------------------------------------------------------------------
-- Nota sobre evolução futura do "status"
-- -------------------------------------------------------------------------
-- Hoje só existem 2 estados (pendente/concluida), então um enum/check em
-- cargas.status é suficiente e mais simples de consultar. Se no futuro o
-- fluxo ganhar mais etapas (ex: "em rota", "cancelada"), vale extrair para
-- uma tabela `status_historico` (carga_id, status, changed_by, changed_at)
-- para manter auditoria completa — a estrutura atual já comporta essa
-- migração sem quebrar nada.

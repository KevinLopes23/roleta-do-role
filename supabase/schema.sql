-- Roleta do Rolê — esquema do banco (Supabase / Postgres)
-- Todo acesso do site passa por funções RPC (security definer). As tabelas ficam com RLS
-- ligado e sem policies, então a chave anon não lê nem escreve nada direto.

create extension if not exists pgcrypto with schema extensions;

-- Nada novo em public nasce acessível pela API: cada função pública recebe grant explícito no fim.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

create table if not exists public.jogadores (
  id            smallint primary key check (id in (1, 2)),
  nome          text not null,
  foto          text,                        -- data URL, só sai do banco depois do login
  pin_hash      text,                        -- null = ainda não configurado
  falhas        int not null default 0,
  bloqueios     int not null default 0,      -- quantas vezes já foi bloqueado (bloqueio progressivo)
  bloqueado_ate timestamptz
);

create table if not exists public.config (
  id                 smallint primary key default 1 check (id = 1),
  vez                smallint references public.jogadores(id),
  convite_hash       text not null,
  convite_falhas     int not null default 0,
  convite_bloq_ate   timestamptz,
  pool_atualizado_em timestamptz
);
-- Com menos lugares disponíveis que isto, a roleta trava até o Kevin pedir lugares novos ao Claude.
alter table public.config add column if not exists minimo_lugares int not null default 10;
-- A busca automática pela API (função gerar-lugares) foi removida: sem custo fora da assinatura.
alter table public.config drop column if exists geracao_status;
alter table public.config drop column if exists geracao_em;
alter table public.config drop column if exists geracao_msg;
drop function if exists public.geracao_iniciar(text);
drop function if exists public.geracao_salvar(jsonb);
drop function if exists public.geracao_falhou(text);
drop function if exists public._pode_gerar();

create table if not exists public.lugares (
  id           text primary key,             -- slug estável nome+cidade (bloqueio de repetição usa ele)
  nome         text not null,
  cidade       text not null,
  distancia_km int  not null default 0,
  categoria    text,
  preco        int  not null check (preco between 1 and 5000),  -- estimativa do total do casal
  faixa        text,
  descricao    text,
  o_que_fazer  text,
  endereco     text,
  horario      text,
  dica         text,
  link         text check (link is null or link ~ '^https://'),
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

create table if not exists public.rodadas (
  id          uuid primary key default gen_random_uuid(),
  quem_leva   smallint not null references public.jogadores(id),
  status      text not null check (status in ('sorteado', 'feito', 'cancelado')),
  lugar_id    text not null references public.lugares(id),
  regiros     int  not null default 0,
  dica        text not null default '',
  quando      text not null default '',
  valor       numeric(10, 2) check (valor is null or valor between 0 and 5000),
  sorteado_em timestamptz not null default now(),
  feito_em    timestamptz
);
alter table public.rodadas add column if not exists fechados int not null default 0;  -- trocas por "lugar fechado"
alter table public.lugares add column if not exists fechado_em timestamptz;            -- marcado como fechado por um jogador
alter table public.lugares add column if not exists verificado_em date;  -- último sinal de atividade conferido (Instagram/site)
create unique index if not exists rodadas_uma_aberta on public.rodadas (quem_leva) where status = 'sorteado';

create table if not exists public.sessoes (
  token_hash text primary key,
  jogador    smallint not null references public.jogadores(id),
  expira_em  timestamptz not null
);

alter table public.jogadores enable row level security;
alter table public.config    enable row level security;
alter table public.lugares   enable row level security;
alter table public.rodadas   enable row level security;
alter table public.rodadas add column if not exists data_role date;  -- dia do rolê, marcado por quem vai levar
alter table public.rodadas add column if not exists foto text;  -- foto do rolê (data URL JPEG, comprimida no celular)
alter table public.lugares add column if not exists grupo text;  -- grupo para o veto secreto (preenchido por gatilho)

-- Nota de 1 a 5 que cada um dá depois do rolê. Média ≤ 2 tira o lugar; média ≥ 4,5 faz ele voltar mais cedo.
create table if not exists public.avaliacoes (
  rodada_id uuid not null references public.rodadas(id) on delete cascade,
  jogador   smallint not null references public.jogadores(id),
  nota      smallint not null check (nota between 1 and 5),
  primary key (rodada_id, jogador)
);

-- Veto secreto: até 3 grupos que cada um não quer; a roleta evita os grupos vetados por qualquer um dos dois.
create table if not exists public.vetos (
  jogador smallint not null references public.jogadores(id),
  grupo   text not null,
  primary key (jogador, grupo)
);

alter table public.sessoes    enable row level security;
alter table public.avaliacoes enable row level security;
alter table public.vetos      enable row level security;
revoke all on public.jogadores, public.config, public.lugares, public.rodadas, public.sessoes, public.avaliacoes, public.vetos from anon, authenticated;

-- Grupo do lugar a partir da categoria/nome (ordem importa: o primeiro que casar vence).
create or replace function public._grupo(p_categoria text, p_nome text) returns text
language sql immutable set search_path = pg_temp as $$
  select case
    when t ~ 'pesq|pesca' then 'pesca'
    when t ~ 'japon|sushi|temaki|oriental|chin' then 'japones'
    when t ~ 'pizz' then 'pizza'
    when t ~ 'burger|hamburg|lanch' then 'hamburguer'
    when t ~ 'arab|liban' then 'arabe'
    when t ~ 'italian|massa|cantina' then 'italiano'
    when t ~ 'churrasc|carne|steak|picanha|grill|parmegiana' then 'carnes'
    when t ~ 'cervej|chope|chopp|bier|vinic|vinho|adega' then 'cervejaria_vinho'
    when t ~ 'cafe|doce|confeit|gelat|sorvet|brunch|padaria|colonial' then 'cafe_doces'
    when t ~ 'paintball|kart|tirolesa|trampolim|escape|boliche|aventura|airsoft|futebol' then 'aventura'
    when t ~ 'cinema|teatro|museu|planet|observ' then 'cultura'
    when t ~ 'spa|massag|day use|termas|aquat' then 'relax'
    when t ~ 'cachoeir|trilha|natureza|praia|parque|orquid|fazenda|passeio|mirante|zoolog|ar livre' then 'natureza'
    when t ~ 'bar|pub|boteco|lounge|drink|musica|cachac|balada' then 'bar'
    else 'outros'
  end
  from (select translate(lower(coalesce(p_categoria, '') || ' ' || coalesce(p_nome, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') as t) x
$$;

create or replace function public._lugar_grupo() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.grupo := _grupo(new.categoria, new.nome);
  return new;
end $$;

drop trigger if exists lugares_grupo on public.lugares;
create trigger lugares_grupo before insert or update of categoria, nome on public.lugares
  for each row execute function public._lugar_grupo();
update public.lugares set grupo = public._grupo(categoria, nome) where grupo is distinct from public._grupo(categoria, nome);

-- ---------------------------------------------------------------- regras do jogo
-- Faixa R$ 20–600, alvo base R$ 160, espalhamento 140, Bauru pesa 1,5x, bloqueio de 76 dias (~2,5 meses),
-- 2 trocas por vez (regirar ou cancelar), PIN de 6–8 dígitos, 5 erros = bloqueio progressivo (15 min, 30, 60…).

create or replace function public._sessao(p_token text) returns smallint
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v smallint;
begin
  select jogador into v from sessoes
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expira_em > now();
  if v is null then raise exception 'sessao_invalida'; end if;
  return v;
end $$;

create or replace function public._nova_sessao(p_jogador smallint) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t text := encode(gen_random_bytes(24), 'hex');
begin
  delete from sessoes where expira_em < now();
  insert into sessoes values (encode(digest(t, 'sha256'), 'hex'), p_jogador, now() + interval '120 days');
  return t;
end $$;

create or replace function public._gastos() returns table (jogador smallint, total numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select j.id, coalesce(sum(r.valor), 0)
    from jogadores j left join rodadas r on r.quem_leva = j.id and r.status = 'feito'
   group by j.id
$$;

create or replace function public._alvo(p_eu smallint, out deficit numeric, out alvo int)
language sql stable security definer set search_path = public, pg_temp as $$
  select d, least(600, greatest(20, round(160 + d)))::int
    from (select coalesce((select total from _gastos() where jogador = 3 - p_eu), 0)
               - coalesce((select total from _gastos() where jogador = p_eu), 0) as d) x
$$;

create or replace function public._disponiveis(p_excluir text default null) returns setof public.lugares
language sql stable security definer set search_path = public, pg_temp as $$
  with notas as (
    select r.lugar_id, avg(a.nota) as media
      from avaliacoes a join rodadas r on r.id = a.rodada_id
     group by r.lugar_id
  )
  select l.* from lugares l
    left join notas n on n.lugar_id = l.id
   where l.ativo and l.preco between 20 and 600
     and l.id is distinct from p_excluir
     and coalesce(n.media, 5) > 2                                        -- reprovado pelo casal não volta
     and coalesce(l.grupo, 'outros') not in (select grupo from vetos)    -- veto secreto de qualquer um dos dois
     and not exists (select 1 from rodadas r where r.lugar_id = l.id
                      and (r.status = 'sorteado'
                           or r.feito_em > now() - case when n.media >= 4.5 then interval '45 days' else interval '76 days' end))
$$;

-- Sorteio ponderado (Efraimidis–Spirakis): peso maior perto do preço-alvo e em Bauru.
create or replace function public._sortear(p_eu smallint, p_excluir text default null) returns text
language sql volatile security definer set search_path = public, pg_temp as $$
  select d.id from _disponiveis(p_excluir) d, _alvo(p_eu) a
   order by -ln(1 - random()) / (exp(-abs(d.preco - a.alvo) / 140.0) * case when d.cidade = 'Bauru' then 1.5 else 1 end)
   limit 1
$$;

-- Trocas já gastas nesta vez: o sorteio cancelado mais recente (desde meu último rolê) + 1 pelo cancelamento.
create or replace function public._trocas_herdadas(p_eu smallint) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(regiros) + 1, 0)::int from rodadas
   where quem_leva = p_eu and status = 'cancelado'
     and sorteado_em > coalesce((select max(feito_em) from rodadas where quem_leva = p_eu and status = 'feito'), '-infinity')
$$;

-- ---------------------------------------------------------------- API pública (RPC)

create or replace function public.jogadores_publico() returns json
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(json_agg(json_build_object('id', id, 'nome', nome, 'configurado', pin_hash is not null) order by id), '[]')
    from jogadores
$$;

create or replace function public.reivindicar(p_jogador smallint, p_nome text, p_pin text, p_convite text) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare c config;
begin
  -- Perfil já ativo: não responde nada sobre o convite.
  if not exists (select 1 from jogadores where id = p_jogador and pin_hash is null) then
    return json_build_object('erro', 'ja_configurado');
  end if;
  select * into c from config where id = 1 for update;
  if c is null then return json_build_object('erro', 'convite_invalido'); end if;
  if c.convite_bloq_ate > now() then return json_build_object('erro', 'bloqueado', 'ate', c.convite_bloq_ate); end if;
  if crypt(coalesce(p_convite, ''), c.convite_hash) <> c.convite_hash then
    update config set
      convite_falhas   = case when c.convite_falhas + 1 >= 5 then 0 else c.convite_falhas + 1 end,
      convite_bloq_ate = case when c.convite_falhas + 1 >= 5 then now() + interval '1 hour' else null end
     where id = 1;
    return json_build_object('erro', 'convite_invalido');
  end if;
  if coalesce(p_pin, '') !~ '^\d{6,8}$' then return json_build_object('erro', 'pin_formato'); end if;
  if length(btrim(coalesce(p_nome, ''))) not between 1 and 24 then return json_build_object('erro', 'nome_invalido'); end if;
  update config set convite_falhas = 0, convite_bloq_ate = null where id = 1;
  update jogadores set nome = btrim(p_nome), pin_hash = crypt(p_pin, gen_salt('bf', 10)), falhas = 0, bloqueios = 0, bloqueado_ate = null
   where id = p_jogador and pin_hash is null;
  update config set vez = p_jogador where id = 1 and vez is null;
  return json_build_object('token', _nova_sessao(p_jogador), 'jogador', p_jogador);
end $$;

create or replace function public.entrar(p_jogador smallint, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare j jogadores; ate timestamptz;
begin
  select * into j from jogadores where id = p_jogador for update;
  if j is null or j.pin_hash is null then return json_build_object('erro', 'pin_errado'); end if;
  if j.bloqueado_ate > now() then return json_build_object('erro', 'bloqueado', 'ate', j.bloqueado_ate); end if;
  if crypt(coalesce(p_pin, ''), j.pin_hash) = j.pin_hash then
    update jogadores set falhas = 0, bloqueios = 0, bloqueado_ate = null where id = p_jogador;
    return json_build_object('token', _nova_sessao(p_jogador), 'jogador', p_jogador);
  end if;
  if j.falhas + 1 >= 5 then
    ate := now() + interval '15 minutes' * power(2, least(j.bloqueios, 6));
    update jogadores set falhas = 0, bloqueios = j.bloqueios + 1, bloqueado_ate = ate where id = p_jogador;
    return json_build_object('erro', 'bloqueado', 'ate', ate);
  end if;
  update jogadores set falhas = j.falhas + 1 where id = p_jogador;
  return json_build_object('erro', 'pin_errado', 'restam', 5 - (j.falhas + 1));
end $$;

create or replace function public.painel(p_token text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  eu smallint := _sessao(p_token);
  a record;
  minha rodadas; dele rodadas; l lugares;
begin
  select * into a from _alvo(eu);
  select * into minha from rodadas where quem_leva = eu and status = 'sorteado';
  select * into dele  from rodadas where quem_leva = 3 - eu and status = 'sorteado';
  if minha.id is not null then select * into l from lugares where id = minha.lugar_id; end if;
  return json_build_object(
    'eu', eu,
    'vez', (select vez from config where id = 1),
    'jogadores', (select json_agg(json_build_object('id', id, 'nome', nome, 'foto', foto, 'configurado', pin_hash is not null) order by id) from jogadores),
    'gastos', (select json_object_agg(jogador, total) from _gastos()),
    'deficit', a.deficit, 'alvo', a.alvo,
    'disponiveis', (select count(*) from _disponiveis()),
    'pool_atualizado_em', (select pool_atualizado_em from config where id = 1),
    'minimo_lugares', (select minimo_lugares from config where id = 1),
    'minha_rodada', case when minha.id is null then null else json_build_object(
        'id', minha.id, 'regiros', minha.regiros, 'fechados', minha.fechados, 'dica', minha.dica, 'quando', minha.quando,
        'sorteado_em', minha.sorteado_em, 'data_role', minha.data_role, 'lugar', row_to_json(l)) end,
    'rodada_dele', case when dele.id is null then null else json_build_object(
        'dica', dele.dica, 'quando', dele.quando, 'sorteado_em', dele.sorteado_em, 'data_role', dele.data_role) end,
    'meus_vetos', (select coalesce(json_agg(grupo order by grupo), '[]') from vetos where jogador = eu),
    'historico', coalesce((select json_agg(h order by h.feito_em desc) from (
        select r.id, r.quem_leva, r.valor, r.feito_em, x.nome, x.cidade, x.categoria, r.foto is not null as tem_foto,
               (select av.nota from avaliacoes av where av.rodada_id = r.id and av.jogador = eu) as minha_nota,
               (select round(avg(av.nota), 1) from avaliacoes av where av.rodada_id = r.id) as media
          from rodadas r join lugares x on x.id = r.lugar_id
         where r.status = 'feito' order by r.feito_em desc limit 60) h), '[]')
  );
end $$;

create or replace function public.girar(p_token text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token); v text; usadas int;
begin
  perform 1 from jogadores where id = eu for update;  -- serializa cliques duplos
  if (select vez from config where id = 1) is distinct from eu then raise exception 'nao_e_sua_vez'; end if;
  if exists (select 1 from rodadas where quem_leva = eu and status = 'sorteado') then raise exception 'ja_sorteado'; end if;
  if (select count(*) from _disponiveis()) < (select minimo_lugares from config where id = 1) then raise exception 'roleta_acabando'; end if;
  usadas := _trocas_herdadas(eu);  -- só estatística: não há limite de giros
  v := _sortear(eu);
  if v is null then raise exception 'sem_lugares'; end if;
  insert into rodadas (quem_leva, status, lugar_id, regiros) values (eu, 'sorteado', v, usadas);
  return painel(p_token);
end $$;

create or replace function public.regirar(p_token text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token); r rodadas; v text;
begin
  select * into r from rodadas where quem_leva = eu and status = 'sorteado' for update;
  if r.id is null then raise exception 'sem_rodada'; end if;
  v := _sortear(eu, r.lugar_id);
  if v is null then raise exception 'sem_outro'; end if;
  update rodadas set lugar_id = v, regiros = regiros + 1 where id = r.id;
  return painel(p_token);
end $$;

drop function if exists public.recado(text, text, text);
drop function if exists public.recado(text, text, text, date);
-- Recado do envelope + o dia do rolê, escolhido por quem vai levar (de hoje até 60 dias).
create or replace function public.recado(p_token text, p_dica text, p_quando text, p_data date default null) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token);
begin
  if p_data is not null and (p_data < current_date or p_data > current_date + 60) then raise exception 'data_invalida'; end if;
  update rodadas set dica = left(btrim(coalesce(p_dica, '')), 140), quando = left(btrim(coalesce(p_quando, '')), 40), data_role = p_data
   where quem_leva = eu and status = 'sorteado';
  if not found then raise exception 'sem_rodada'; end if;
  return painel(p_token);
end $$;

create or replace function public.concluir(p_token text, p_valor numeric) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token);
begin
  if p_valor is null or p_valor < 0 or p_valor > 5000 then raise exception 'valor_invalido'; end if;
  update rodadas set status = 'feito', valor = round(p_valor, 2), feito_em = now()
   where quem_leva = eu and status = 'sorteado';
  if not found then raise exception 'sem_rodada'; end if;
  update config set vez = 3 - eu where id = 1;
  return painel(p_token);
end $$;

-- Lugar fechado/indisponível: tira o lugar da roleta e sorteia outro sem gastar troca (até 3 por rodada).
create or replace function public.lugar_fechado(p_token text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token); r rodadas; v text;
begin
  select * into r from rodadas where quem_leva = eu and status = 'sorteado' for update;
  if r.id is null then raise exception 'sem_rodada'; end if;
  update lugares set ativo = false, fechado_em = now() where id = r.lugar_id;
  v := _sortear(eu, r.lugar_id);
  if v is null then raise exception 'sem_outro'; end if;
  update rodadas set lugar_id = v, fechados = fechados + 1 where id = r.id;
  return painel(p_token);
end $$;

-- Avaliação depois do rolê: cada um dá (ou muda) a sua nota de 1 a 5.
create or replace function public.avaliar(p_token text, p_rodada uuid, p_nota int) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token);
begin
  if p_nota is null or p_nota not between 1 and 5 then raise exception 'nota_invalida'; end if;
  if not exists (select 1 from rodadas where id = p_rodada and status = 'feito') then raise exception 'sem_rodada'; end if;
  insert into avaliacoes (rodada_id, jogador, nota) values (p_rodada, eu, p_nota)
    on conflict (rodada_id, jogador) do update set nota = excluded.nota;
  return painel(p_token);
end $$;

-- Veto secreto: substitui os vetos do jogador (no máximo 3 grupos conhecidos).
create or replace function public.vetos_salvar(p_token text, p_grupos text[]) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token); g text[] := coalesce(p_grupos, '{}');
begin
  if cardinality(g) > 3 then raise exception 'vetos_demais'; end if;
  if exists (select 1 from unnest(g) x where x not in ('japones','pizza','hamburguer','arabe','italiano','carnes',
      'cervejaria_vinho','cafe_doces','aventura','cultura','relax','natureza','bar','pesca')) then
    raise exception 'veto_invalido';
  end if;
  delete from vetos where jogador = eu;
  insert into vetos (jogador, grupo) select distinct eu, x from unnest(g) x;
  return painel(p_token);
end $$;

-- Foto do rolê (qualquer um dos dois, só em rolê feito). Imagem JPEG já comprimida no celular, até ~300 KB.
create or replace function public.foto_salvar(p_token text, p_rodada uuid, p_foto text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token);
begin
  if p_foto is null or p_foto !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' or length(p_foto) > 400000 then
    raise exception 'foto_invalida';
  end if;
  update rodadas set foto = p_foto where id = p_rodada and status = 'feito';
  if not found then raise exception 'sem_rodada'; end if;
  return painel(p_token);
end $$;

create or replace function public.foto(p_token text, p_rodada uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token);
begin
  return (select foto from rodadas where id = p_rodada and status = 'feito');
end $$;

-- Cancelar: o sorteio some e a pessoa gira de novo (sem limite de giros, a pedido do casal).
create or replace function public.cancelar(p_token text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare eu smallint := _sessao(p_token); r rodadas;
begin
  select * into r from rodadas where quem_leva = eu and status = 'sorteado' for update;
  if r.id is null then raise exception 'sem_rodada'; end if;
  update rodadas set status = 'cancelado' where id = r.id;
  return painel(p_token);
end $$;

create or replace function public.sair(p_token text) returns void
language sql security definer set search_path = public, extensions, pg_temp as $$
  delete from sessoes where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- Só a API pública fica exposta (para anon); helpers internos e o papel authenticated, não.
revoke all on function public._sessao(text), public._nova_sessao(smallint), public._gastos(), public._alvo(smallint),
  public._disponiveis(text), public._sortear(smallint, text), public._trocas_herdadas(smallint), public._grupo(text, text), public._lugar_grupo() from public, anon, authenticated;
revoke all on function public.jogadores_publico(), public.reivindicar(smallint, text, text, text), public.entrar(smallint, text),
  public.painel(text), public.girar(text), public.regirar(text), public.recado(text, text, text, date),
  public.concluir(text, numeric), public.cancelar(text), public.lugar_fechado(text), public.sair(text), public.avaliar(text, uuid, int), public.vetos_salvar(text, text[]), public.foto_salvar(text, uuid, text), public.foto(text, uuid) from public, authenticated;
grant execute on function public.jogadores_publico(), public.reivindicar(smallint, text, text, text), public.entrar(smallint, text),
  public.painel(text), public.girar(text), public.regirar(text), public.recado(text, text, text, date),
  public.concluir(text, numeric), public.cancelar(text), public.lugar_fechado(text), public.sair(text), public.avaliar(text, uuid, int), public.vetos_salvar(text, text[]), public.foto_salvar(text, uuid, text), public.foto(text, uuid) to anon;

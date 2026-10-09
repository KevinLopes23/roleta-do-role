// Testa supabase/schema.sql num Postgres embutido (PGlite), com os papéis do Supabase simulados.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { lugaresParaSql } from "./gerar-seeds.mjs";

const SCHEMA = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const CONVITE = "convite-teste";

let db;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const rpc = async (fn, ...args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(", ");
  return (await one(`select public.${fn}(${ph}) as r`, args)).r;
};
const falha = (promise, msg) => assert.rejects(promise, (e) => e.message.includes(msg));

async function reiniciarJogo() {
  await db.exec(`
    delete from rodadas; delete from sessoes;
    update jogadores set pin_hash = null, falhas = 0, bloqueios = 0, bloqueado_ate = null;
    update config set vez = null, convite_falhas = 0, convite_bloq_ate = null, minimo_lugares = 0;`);
}

async function criarCasal() {
  const a = await rpc("reivindicar", 1, "Kevin", "123456", CONVITE);
  const b = await rpc("reivindicar", 2, "Ela", "987654", CONVITE);
  return { kevin: a.token, ela: b.token };
}

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`create schema extensions; create role anon nologin; create role authenticated nologin;`);
  await db.exec(SCHEMA);
  await db.exec(`
    insert into jogadores (id, nome, foto) values (1, 'Kevin', 'data:image/jpeg;base64,AAA'), (2, 'Ela', 'data:image/jpeg;base64,BBB');
    insert into config (id, convite_hash) values (1, extensions.crypt('${CONVITE}', extensions.gen_salt('bf')));
    insert into lugares (id, nome, cidade, preco) values
      ('barato-bauru', 'Barato', 'Bauru', 40), ('medio-bauru', 'Médio', 'Bauru', 160),
      ('caro-bauru', 'Caro', 'Bauru', 550), ('caro-jau', 'Caro Jaú', 'Jaú', 580),
      ('fora-faixa', 'Fora da faixa', 'Bauru', 900), ('inativo', 'Inativo', 'Bauru', 100);
    update lugares set ativo = false where id = 'inativo';`);
});

test("lista pública não expõe fotos nem PIN", async () => {
  await reiniciarJogo();
  const js = await rpc("jogadores_publico");
  assert.equal(js.length, 2);
  assert.deepEqual(Object.keys(js[0]).sort(), ["configurado", "id", "nome"]);
});

test("reivindicar exige convite, PIN de 4 a 8 dígitos e só funciona uma vez", async () => {
  await reiniciarJogo();
  assert.equal((await rpc("reivindicar", 1, "Kevin", "123456", "errado")).erro, "convite_invalido");
  assert.equal((await rpc("reivindicar", 1, "Kevin", "1234", CONVITE)).erro, "pin_formato");
  const ok = await rpc("reivindicar", 1, "Kevin", "123456", CONVITE);
  assert.ok(ok.token.length >= 40);
  assert.equal((await rpc("reivindicar", 1, "Outro", "000000", CONVITE)).erro, "ja_configurado");
  assert.equal((await one("select vez from config")).vez, 1, "quem entra primeiro começa");
});

test("PIN errado 5 vezes bloqueia o login", async () => {
  await reiniciarJogo();
  await criarCasal();
  for (let i = 0; i < 4; i++) assert.equal((await rpc("entrar", 2, "000000")).erro, "pin_errado");
  assert.equal((await rpc("entrar", 2, "000000")).erro, "bloqueado");
  assert.equal((await rpc("entrar", 2, "987654")).erro, "bloqueado", "nem o PIN certo entra durante o bloqueio");
  await db.exec("update jogadores set bloqueado_ate = null where id = 2");
  assert.ok((await rpc("entrar", 2, "987654")).token);
});

test("painel recusa token inválido", async () => {
  await falha(rpc("painel", "token-falso"), "sessao_invalida");
});

test("sorteio é segredo: o outro vê só dica e quando", async () => {
  await reiniciarJogo();
  const { kevin, ela } = await criarCasal();
  await falha(rpc("girar", ela), "nao_e_sua_vez");
  const p = await rpc("girar", kevin);
  assert.ok(p.minha_rodada.lugar.nome);
  await falha(rpc("girar", kevin), "ja_sorteado");
  await rpc("recado", kevin, "  vai de tênis  ", "sábado 18h");
  const visao = await rpc("painel", ela);
  assert.equal(visao.minha_rodada, null);
  assert.deepEqual(Object.keys(visao.rodada_dele).sort(), ["data_role", "dica", "quando", "sorteado_em"]);
  assert.equal(visao.rodada_dele.dica, "vai de tênis");
  assert.ok(!JSON.stringify(visao).includes(p.minha_rodada.lugar.id), "o id do lugar não vaza pro outro");
});

test("regirar troca o lugar sem limite de vezes", async () => {
  await reiniciarJogo();
  const { kevin } = await criarCasal();
  const a = (await rpc("girar", kevin)).minha_rodada.lugar.id;
  const b = (await rpc("regirar", kevin)).minha_rodada.lugar.id;
  assert.notEqual(a, b);
  for (let i = 0; i < 5; i++) assert.ok((await rpc("regirar", kevin)).minha_rodada.lugar.id);
});

test("só sorteia lugares ativos dentro de R$ 20–600", async () => {
  await reiniciarJogo();
  const ids = (await db.query("select id from _disponiveis()")).rows.map((r) => r.id).sort();
  assert.deepEqual(ids, ["barato-bauru", "caro-bauru", "caro-jau", "medio-bauru"]);
});

test("concluir passa a vez, soma o gasto e bloqueia o lugar por 76 dias", async () => {
  await reiniciarJogo();
  const { kevin, ela } = await criarCasal();
  const lugar = (await rpc("girar", kevin)).minha_rodada.lugar.id;
  await falha(rpc("concluir", kevin, -5), "valor_invalido");
  const p = await rpc("concluir", kevin, 180.5);
  assert.equal(p.vez, 2);
  assert.equal(Number(p.gastos["1"]), 180.5);
  assert.equal(p.historico[0].quem_leva, 1);
  assert.equal(p.disponiveis, 3);
  const pdela = await rpc("painel", ela);
  assert.equal(Number(pdela.deficit), 180.5, "ela está devendo 180,50");
  await db.query("update rodadas set feito_em = now() - interval '77 days' where lugar_id = $1", [lugar]);
  assert.equal((await rpc("painel", ela)).disponiveis, 4, "depois de 76 dias o lugar volta");
});

test("quem gastou menos tende a cair em rolês mais caros", async () => {
  await reiniciarJogo();
  await criarCasal();
  await db.exec(`insert into rodadas (quem_leva, status, lugar_id, valor, feito_em)
                 values (1, 'feito', 'fora-faixa', 450, now() - interval '200 days')`);
  const alvo = await one("select * from _alvo(2::smallint)");
  assert.equal(alvo.alvo, 600);
  let soma = 0;
  for (let i = 0; i < 300; i++) soma += (await one("select l.preco from lugares l where l.id = (select _sortear(2::smallint))")).preco;
  assert.ok(soma / 300 > 380, `média ${soma / 300} deveria puxar pra cima`);
  const alvoKevin = await one("select * from _alvo(1::smallint)");
  assert.equal(alvoKevin.alvo, 20);
});

test("cancelar mantém a vez e não tem limite", async () => {
  await reiniciarJogo();
  const { kevin } = await criarCasal();
  await rpc("girar", kevin);
  const p = await rpc("cancelar", kevin);
  assert.equal(p.minha_rodada, null);
  assert.equal(p.vez, 1);
  for (let i = 0; i < 4; i++) { await rpc("girar", kevin); await rpc("regirar", kevin); await rpc("cancelar", kevin); }
  assert.ok((await rpc("girar", kevin)).minha_rodada, "pode cancelar e girar quantas vezes quiser");
});

test("depois do rolê feito, a próxima vez começa sem trocas usadas", async () => {
  await reiniciarJogo();
  const { kevin, ela } = await criarCasal();
  await rpc("girar", kevin); await rpc("cancelar", kevin); await rpc("girar", kevin);
  await rpc("concluir", kevin, 100);
  await rpc("girar", ela); await rpc("concluir", ela, 100);
  assert.equal((await rpc("girar", kevin)).minha_rodada.regiros, 0);
});

test("convite errado 5 vezes bloqueia por 1 hora; perfil ativo não responde sobre o convite", async () => {
  await reiniciarJogo();
  for (let i = 0; i < 5; i++) assert.equal((await rpc("reivindicar", 1, "X", "123456", "chute" + i)).erro, "convite_invalido");
  assert.equal((await rpc("reivindicar", 1, "X", "123456", CONVITE)).erro, "bloqueado", "nem o convite certo passa no bloqueio");
  await db.exec("update config set convite_bloq_ate = null");
  await rpc("reivindicar", 1, "Kevin", "123456", CONVITE);
  assert.equal((await rpc("reivindicar", 1, "X", "123456", "chute")).erro, "ja_configurado");
});

test("o papel authenticated não executa nenhuma função", async () => {
  await db.exec("set role authenticated");
  try {
    await falha(db.query("select jogadores_publico()"), "permission denied");
    await falha(db.query("select painel('x')"), "permission denied");
  } finally {
    await db.exec("reset role");
  }
});

test("bloqueio do PIN cresce a cada série de erros", async () => {
  await reiniciarJogo();
  await criarCasal();
  const bloquear = async () => { let r; for (let i = 0; i < 5; i++) r = await rpc("entrar", 2, "000000"); return new Date(r.ate) - Date.now(); };
  const primeiro = await bloquear();
  await db.exec("update jogadores set bloqueado_ate = null where id = 2");
  const segundo = await bloquear();
  assert.ok(primeiro > 14 * 60e3 && primeiro <= 15 * 60e3);
  assert.ok(segundo > 29 * 60e3 && segundo <= 30 * 60e3);
});

test("a chave anon não lê tabelas nem chama helpers", async () => {
  await db.exec("set role anon");
  try {
    await falha(db.query("select * from lugares"), "permission denied");
    await falha(db.query("select * from jogadores"), "permission denied");
    await falha(db.query("select _sortear(1::smallint)"), "permission denied");
    const js = (await db.query("select jogadores_publico() as r")).rows[0].r;
    assert.equal(js.length, 2);
  } finally {
    await db.exec("reset role");
  }
});

test("com menos lugares que o mínimo, a roleta trava o giro (mas não o sorteio já feito)", async () => {
  await reiniciarJogo();
  const { kevin } = await criarCasal();
  await rpc("girar", kevin);
  await db.exec("update config set minimo_lugares = 10");
  try {
    assert.equal((await rpc("painel", kevin)).minimo_lugares, 10);
    assert.ok((await rpc("regirar", kevin)).minha_rodada, "quem já sorteou continua podendo trocar");
    await rpc("cancelar", kevin);
    await falha(rpc("girar", kevin), "roleta_acabando");
  } finally {
    await db.exec("update config set minimo_lugares = 0");
  }
});

test("lugar fechado: tira da roleta e sorteia outro, sem limite", async () => {
  await reiniciarJogo();
  await db.exec("update lugares set ativo = true, fechado_em = null where id <> 'inativo'");
  await db.exec(`insert into lugares (id, nome, cidade, preco) values ('extra-1','Extra 1','Bauru',100),('extra-2','Extra 2','Bauru',120)
                 on conflict (id) do update set ativo = true, fechado_em = null`);
  const { kevin } = await criarCasal();
  const primeiro = (await rpc("girar", kevin)).minha_rodada.lugar.id;
  const p = await rpc("lugar_fechado", kevin);
  assert.notEqual(p.minha_rodada.lugar.id, primeiro);
  assert.equal(p.minha_rodada.regiros, 0, "não gasta as trocas normais");
  assert.equal(p.minha_rodada.fechados, 1);
  const fechado = (await db.query("select ativo, fechado_em from lugares where id = $1", [primeiro])).rows[0];
  assert.equal(fechado.ativo, false);
  assert.ok(fechado.fechado_em);
  await rpc("lugar_fechado", kevin);
  await rpc("lugar_fechado", kevin);
  assert.equal((await rpc("lugar_fechado", kevin)).minha_rodada.fechados, 4, "sem limite de lugares fechados");
  await db.exec("delete from rodadas; update lugares set ativo = true, fechado_em = null; delete from lugares where id like 'extra-%'");
  await db.exec("update lugares set ativo = false where id = 'inativo'");
});

test("seed de lugares não reativa lugar marcado como fechado", async () => {
  await db.exec("update lugares set ativo = false, fechado_em = now() where id = 'medio-bauru'");
  await db.exec(lugaresParaSql([{ id: "medio-bauru", nome: "Médio", cidade: "Bauru", preco: 160 }]));
  assert.equal((await db.query("select ativo from lugares where id = 'medio-bauru'")).rows[0].ativo, false);
  await db.exec("update lugares set ativo = true, fechado_em = null where id = 'medio-bauru'");
});

test("grupo do lugar é preenchido pela categoria", async () => {
  const g = async (cat, nome = "x") => (await one("select _grupo($1, $2) as g", [cat, nome])).g;
  assert.equal(await g("Japonês e chinês"), "japones");
  assert.equal(await g("Pesqueiro"), "pesca");
  assert.equal(await g("Bar com música ao vivo"), "bar");
  assert.equal(await g("Cervejaria"), "cervejaria_vinho");
  assert.equal(await g("Cachoeira"), "natureza");
  assert.equal(await g("Café da manhã"), "cafe_doces");
  assert.equal(await g(null, "Zzz"), "outros");
  await db.exec("insert into lugares (id, nome, cidade, categoria, preco) values ('sushi-teste','Sushi Teste','Bauru','Japonês',150)");
  assert.equal((await one("select grupo from lugares where id = 'sushi-teste'")).grupo, "japones");
  await db.exec("delete from lugares where id = 'sushi-teste'");
});

test("veto secreto: tira o grupo da roleta, máximo 3, e o outro não vê", async () => {
  await reiniciarJogo();
  await db.exec("delete from vetos; update lugares set grupo = _grupo(categoria, nome)");
  const { kevin, ela } = await criarCasal();
  const antes = (await rpc("painel", ela)).disponiveis;
  await db.exec("update lugares set categoria = 'Pesqueiro' where id = 'barato-bauru'");
  const p = await rpc("vetos_salvar", kevin, ["pesca"]);
  assert.deepEqual(p.meus_vetos, ["pesca"]);
  assert.equal((await rpc("painel", ela)).disponiveis, antes - 1, "veto de um vale pros dois");
  assert.deepEqual((await rpc("painel", ela)).meus_vetos, [], "o outro não vê o veto");
  await falha(rpc("vetos_salvar", kevin, ["pesca", "bar", "pizza", "relax"]), "vetos_demais");
  await falha(rpc("vetos_salvar", kevin, ["qualquer"]), "veto_invalido");
  await rpc("vetos_salvar", kevin, []);
  await db.exec("update lugares set categoria = null where id = 'barato-bauru'");
});

test("avaliação: nota de cada um, média no álbum, reprovado sai e nota alta volta mais cedo", async () => {
  await reiniciarJogo();
  await db.exec("delete from vetos");
  const { kevin, ela } = await criarCasal();
  const lugar = (await rpc("girar", kevin)).minha_rodada.lugar.id;
  const p = await rpc("concluir", kevin, 100);
  const rodada = p.historico[0].id;
  await falha(rpc("avaliar", kevin, rodada, 6), "nota_invalida");
  await rpc("avaliar", kevin, rodada, 5);
  const visao = await rpc("avaliar", ela, rodada, 4);
  assert.equal(visao.historico[0].minha_nota, 4);
  assert.equal(Number(visao.historico[0].media), 4.5);
  await db.query("update rodadas set feito_em = now() - interval '50 days' where id = $1", [rodada]);
  assert.equal((await db.query("select count(*)::int n from _disponiveis() where id = $1", [lugar])).rows[0].n, 1, "média 4,5 volta depois de 45 dias");
  await rpc("avaliar", kevin, rodada, 1);
  await rpc("avaliar", ela, rodada, 2);
  assert.equal((await db.query("select count(*)::int n from _disponiveis() where id = $1", [lugar])).rows[0].n, 0, "média ≤ 2 sai da roleta");
});

test("foto do rolê: só JPEG em data URL, só em rolê feito, carregada sob demanda", async () => {
  await reiniciarJogo();
  const { kevin, ela } = await criarCasal();
  await rpc("girar", kevin);
  const rodada = (await rpc("concluir", kevin, 80)).historico[0].id;
  await falha(rpc("foto_salvar", ela, rodada, "data:image/png;base64,AAAA"), "foto_invalida");
  await falha(rpc("foto_salvar", ela, rodada, "javascript:alert(1)"), "foto_invalida");
  const p = await rpc("foto_salvar", ela, rodada, "data:image/jpeg;base64,/9j/AAAA");
  assert.equal(p.historico[0].tem_foto, true);
  assert.ok(!JSON.stringify(p).includes("/9j/AAAA"), "o painel não carrega a foto inteira");
  assert.equal(await rpc("foto", kevin, rodada), "data:image/jpeg;base64,/9j/AAAA");
  await falha(rpc("foto", "token-falso", rodada), "sessao_invalida");
});

test("quem leva escolhe o dia do rolê, e o outro vê a data no envelope", async () => {
  await reiniciarJogo();
  const { kevin, ela } = await criarCasal();
  await rpc("girar", kevin);
  const daqui3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const p = await rpc("recado", kevin, "leva casaco", "19h", daqui3);
  assert.equal(p.minha_rodada.data_role, daqui3);
  assert.equal((await rpc("painel", ela)).rodada_dele.data_role, daqui3);
  await falha(rpc("recado", kevin, "", "", "2020-01-01"), "data_invalida");
});

test("a roleta só aparece pro outro depois que o rolê é confirmado", async () => {
  await reiniciarJogo();
  const { kevin, ela } = await criarCasal();
  await rpc("girar", kevin);
  await falha(rpc("girar", ela), "nao_e_sua_vez");
  await rpc("concluir", kevin, 120);
  assert.ok((await rpc("girar", ela)).minha_rodada, "depois do rolê feito, a vez é dela");
});

test("sair invalida o token", async () => {
  await reiniciarJogo();
  const { kevin } = await criarCasal();
  await rpc("sair", kevin);
  await falha(rpc("painel", kevin), "sessao_invalida");
});

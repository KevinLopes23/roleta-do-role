// Garante que o SQL gerado a partir de supabase/lugares.json entra no banco sem quebrar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { lugaresParaSql, validarLugar } from "./gerar-seeds.mjs";

const ler = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

async function bancoNovo() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec("create schema extensions; create role anon nologin; create role authenticated nologin;");
  await db.exec(ler("../supabase/schema.sql"));
  return db;
}

test("validarLugar recusa link sem https, preço quebrado e id fora do padrão", () => {
  assert.deepEqual(validarLugar({ id: "ok-bauru", nome: "Ok", cidade: "Bauru", preco: 100 }), []);
  const erros = validarLugar({ id: "Com Espaço", nome: "X", cidade: "Bauru", preco: 10.5, link: "http://x.com" });
  assert.equal(erros.length, 3);
});

test("lugares.json vira SQL válido, com aspas escapadas e upsert idempotente", async () => {
  const db = await bancoNovo();
  await db.exec("insert into config (id, convite_hash) values (1, 'x')");
  const lugares = JSON.parse(ler("../supabase/lugares.json"));
  const extra = { id: "teste-aspas", nome: "Bar do Zé's", cidade: "Bauru", preco: 50, descricao: "it's '; drop table lugares; --" };
  const sql = lugaresParaSql([...lugares, extra]);
  await db.exec(sql);
  await db.exec(sql);
  const { rows } = await db.query("select count(*)::int as n from lugares");
  assert.equal(rows[0].n, lugares.length + 1);
  const ze = (await db.query("select descricao from lugares where id = 'teste-aspas'")).rows[0];
  assert.equal(ze.descricao, extra.descricao);
  assert.ok((await db.query("select pool_atualizado_em from config")).rows[0].pool_atualizado_em);
});

test("seed privado (quando existe) cria os dois jogadores com foto", { skip: !existsSync(new URL("../supabase/seed-privado.sql", import.meta.url)) }, async () => {
  const db = await bancoNovo();
  await db.exec(ler("../supabase/seed-privado.sql"));
  const { rows } = await db.query("select id, left(foto, 23) as f from jogadores order by id");
  assert.deepEqual(rows.map((r) => r.f), ["data:image/jpeg;base64,", "data:image/jpeg;base64,"]);
  const convite = ler("../fotos/convite.txt").trim();
  const r = (await db.query("select reivindicar(1::smallint, 'Kevin', '123456', $1) as r", [convite])).rows[0].r;
  assert.ok(r.token, "o convite gerado funciona");
});

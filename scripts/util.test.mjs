import { test } from "node:test";
import assert from "node:assert/strict";
import { brl, lerValor, primeiroNome, mensagemErro, dataCurta, contagemRole, dataCampo } from "../util.js";

const dia = (a, m, d, h = 12) => new Date(a, m - 1, d, h);

test("contagem regressiva conta até o dia escolhido por quem leva", () => {
  const hoje = dia(2026, 10, 9);
  assert.equal(contagemRole("2026-10-13", hoje).dias, 4);
  assert.match(contagemRole("2026-10-13", hoje).titulo, /faltam 4 dias/);
  assert.match(contagemRole("2026-10-10", hoje).titulo, /amanhã/);
  assert.match(contagemRole("2026-10-09", hoje).titulo, /hoje/);
  assert.match(contagemRole("2026-10-08", hoje).titulo, /já passou/);
  assert.equal(contagemRole(null, hoje), null);
  assert.equal(contagemRole("2026-02-31", hoje), null, "data impossível");
});

test("dataCampo gera o formato do campo de data", () => {
  assert.equal(dataCampo(0, dia(2026, 10, 9)), "2026-10-09");
  assert.equal(dataCampo(60, dia(2026, 10, 9)), "2026-12-08");
});

test("lerValor aceita formatos brasileiros e recusa lixo", () => {
  assert.equal(lerValor("180"), 180);
  assert.equal(lerValor("180,50"), 180.5);
  assert.equal(lerValor("R$ 1.250,00"), 1250);
  assert.equal(lerValor("99.9"), 99.9);
  assert.equal(lerValor("0"), 0);
  for (const ruim of ["", "abc", "-5", "12,345", "6000", "1.2.3"]) assert.equal(lerValor(ruim), null, ruim);
});

test("brl mostra centavos só quando existem", () => {
  assert.equal(brl(180), "R$ 180");
  assert.match(brl(180.5), /^R\$ 180,50$/);
  assert.equal(brl(null), "R$ 0");
});

test("primeiroNome e mensagens têm fallback", () => {
  assert.equal(primeiroNome("  Maria Clara "), "Maria");
  assert.equal(primeiroNome(""), "Alguém");
  assert.equal(mensagemErro("pin_errado"), "PIN errado.");
  assert.match(mensagemErro("codigo_que_nao_existe"), /deu errado/);
  assert.equal(dataCurta("nao-e-data"), "");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { brl, lerValor, primeiroNome, mensagemErro, dataCurta, sabadoDoRole, contagemRole } from "../util.js";

const dia = (a, m, d, h = 12) => new Date(a, m - 1, d, h);

test("o rolê é no sábado do fim de semana seguinte ao sorteio", () => {
  // 9/out/2026 é sexta
  assert.equal(sabadoDoRole(dia(2026, 10, 9)).getDate(), 10, "sorteou sexta → amanhã");
  assert.equal(sabadoDoRole(dia(2026, 10, 6)).getDate(), 10, "terça → sábado da mesma semana");
  assert.equal(sabadoDoRole(dia(2026, 10, 10)).getDate(), 17, "sábado → sábado seguinte");
  assert.equal(sabadoDoRole(dia(2026, 10, 11)).getDate(), 17, "domingo → sábado seguinte");
  assert.equal(sabadoDoRole("lixo"), null);
});

test("contagem regressiva muda de texto conforme o dia", () => {
  const sorteio = dia(2026, 10, 6);
  assert.equal(contagemRole(sorteio, dia(2026, 10, 6)).dias, 4);
  assert.match(contagemRole(sorteio, dia(2026, 10, 6)).titulo, /faltam 4 dias/);
  assert.match(contagemRole(sorteio, dia(2026, 10, 9)).titulo, /amanhã/);
  assert.match(contagemRole(sorteio, dia(2026, 10, 10)).titulo, /fim de semana de rolê/);
  assert.match(contagemRole(sorteio, dia(2026, 10, 11)).titulo, /fim de semana de rolê/);
  assert.match(contagemRole(sorteio, dia(2026, 10, 13)).titulo, /já passou/);
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

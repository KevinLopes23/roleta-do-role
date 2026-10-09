import { test } from "node:test";
import assert from "node:assert/strict";
import { brl, lerValor, primeiroNome, mensagemErro, dataCurta } from "../util.js";

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

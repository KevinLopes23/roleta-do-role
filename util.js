// Funções puras usadas pelo app (e testadas em scripts/util.test.mjs).

/** @param {number|string|null} n @returns {string} */
export function brl(n) {
  const v = Number(n) || 0;
  const centavos = Math.round(v * 100) % 100 !== 0;
  return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: centavos ? 2 : 0, maximumFractionDigits: 2 });
}

/** Lê "180", "180,50", "1.250,00" ou "R$ 99" → número (2 casas) ou null se inválido. */
export function lerValor(texto) {
  const limpo = String(texto ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(limpo)) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const v = Math.round(Number(normal) * 100) / 100;
  return Number.isFinite(v) && v >= 0 && v <= 5000 ? v : null;
}

/** @param {string} iso @returns {string} ex.: "12 out" */
export function dataCurta(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
}

const DIA_MS = 86400000;
const meiaNoite = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** O rolê é no fim de semana seguinte ao sorteio: devolve o sábado (sorteou no sábado/domingo → sábado seguinte). */
export function sabadoDoRole(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const base = meiaNoite(d);
  const ate = ((6 - base.getDay() + 7) % 7) || 7;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + ate);
}

/** Contagem regressiva até o fim de semana do rolê. `agora` só existe pra teste. */
export function contagemRole(iso, agora = new Date()) {
  const sabado = sabadoDoRole(iso);
  if (!sabado) return null;
  const dias = Math.round((sabado - meiaNoite(agora)) / DIA_MS);
  const data = `${sabado.toLocaleDateString("pt-BR", { day: "numeric", month: "long" })} e ${new Date(sabado.getTime() + DIA_MS).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`;
  let titulo;
  if (dias > 1) titulo = `faltam ${dias} dias pro rolê`;
  else if (dias === 1) titulo = "o rolê é amanhã!";
  else if (dias >= -1) titulo = "é fim de semana de rolê ♥";
  else titulo = "o fim de semana do rolê já passou";
  return { dias, titulo, data: dias >= -1 ? `sáb e dom · ${data}` : "Já foi? Marque como feito." };
}

export const primeiroNome =(nome) => String(nome ?? "").trim().split(/\s+/)[0] || "Alguém";

const MENSAGENS = {
  convite_invalido: "Código do convite errado.",
  pin_formato: "O PIN precisa ter de 6 a 8 números.",
  nome_invalido: "Coloca um nome de até 24 letras.",
  ja_configurado: "Esse perfil já tem PIN. Volta e entra com ele.",
  nao_configurado: "Esse perfil ainda não foi ativado.",
  bloqueado: "Muitas tentativas. Espera 15 minutos e tenta de novo.",
  pin_errado: "PIN errado.",
  sessao_invalida: "Sua sessão expirou. Entra de novo.",
  nao_e_sua_vez: "Agora é a vez do outro girar.",
  ja_sorteado: "Você já sorteou. Raspe o bilhete.",
  sem_lugares: "A roleta está vazia. Peça pro Claude buscar lugares novos.",
  roleta_acabando: "A roleta está acabando. O Kevin precisa pedir lugares novos pro Claude antes do próximo giro.",
  sem_regiros: "Acabaram os giros extras dessa rodada.",
  sem_fechados: "Já foram 3 lugares fechados nesta rodada. Use “Girar de novo” ou “Cancelar”.",
  sem_outro: "Não tem outra opção na roleta agora.",
  sem_rodada: "Não tem sorteio aberto.",
  valor_invalido: "Coloque um valor válido, tipo 180 ou 180,50.",
  rede: "Sem conexão. Confere a internet e tenta de novo.",
  nota_invalida: "A nota vai de 1 a 5 corações.",
  vetos_demais: "No máximo 3 vetos.",
  veto_invalido: "Esse tipo de rolê não existe.",
  foto_invalida: "Não deu pra usar essa foto. Tenta outra.",
  foto_ilegivel: "Não consegui abrir essa foto. Tenta outra (JPG ou da galeria).",
};

/** @param {string} codigo @returns {string} */
export const mensagemErro = (codigo) => MENSAGENS[codigo] || "Algo deu errado. Tenta de novo.";

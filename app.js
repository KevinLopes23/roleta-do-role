// Roleta do Rolê — telas e fluxo. O banco decide tudo (sorteio, vez, segredo); aqui é só a experiência.
// O ?v= força o celular a baixar a versão nova depois de cada publicação (o GitHub Pages guarda cache por 10 min).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=5";
import { h, coracao, Roda, raspadinha, gangorra, confete, toast, folha, folhaAberta, tecladoPin, movimentoReduzido } from "./componentes.js?v=5";
import { brl, lerValor, dataCurta, primeiroNome, mensagemErro } from "./util.js?v=5";

const app = document.getElementById("app");
const CHAVE_SESSAO = "roleta.sessao";
const ATUALIZA_MS = 30000;
const est = { sessao: lerLocal(CHAVE_SESSAO), painel: null, assinatura: "", ocupado: false };

// ---------------------------------------------------------------- infraestrutura

function lerLocal(chave) { try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; } }
function gravarLocal(chave, valor) {
  try { if (valor == null) localStorage.removeItem(chave); else localStorage.setItem(chave, JSON.stringify(valor)); }
  catch { /* modo privado: segue sem lembrar */ }
}

class ErroApp extends Error {}

async function rpc(fn, args = {}) {
  let resp;
  try {
    resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch {
    throw new ErroApp("rede");
  }
  const corpo = await resp.json().catch(() => null);
  if (!resp.ok) {
    const codigo = String(corpo?.message || "erro");
    if (codigo === "sessao_invalida") { gravarLocal(CHAVE_SESSAO, null); est.sessao = null; setTimeout(iniciar, 1200); }
    throw new ErroApp(codigo);
  }
  return corpo;
}

const comSessao = (fn, extra = {}) => rpc(fn, { p_token: est.sessao?.token, ...extra });

function trocarTela(...conteudo) {
  const trocar = () => { app.replaceChildren(...conteudo); window.scrollTo({ top: 0 }); };
  if (!document.startViewTransition || movimentoReduzido() || document.visibilityState !== "visible") return trocar();
  const transicao = document.startViewTransition(trocar);
  transicao.ready.catch(() => { /* animação abortada pelo navegador: a tela já foi trocada */ });
}

const entra = (el, i) => { el.classList.add("entra"); el.style.setProperty("--i", i); return el; };

async function acao(botao, fn) {
  if (est.ocupado) return;
  est.ocupado = true;
  if (botao) botao.disabled = true;
  try { await fn(); }
  catch (e) { toast(mensagemErro(e.message), true); }
  finally { est.ocupado = false; if (botao?.isConnected) botao.disabled = false; }
}

// ---------------------------------------------------------------- entrada

async function iniciar() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return telaAviso("Quase lá", "O site está sendo configurado. Volte daqui a pouco.");
  if (est.sessao?.token) {
    try { return mostrarPainel(await comSessao("painel"), true); }
    catch (e) { if (e.message === "rede") return telaAviso("Sem conexão", mensagemErro("rede"), iniciar); }
  }
  try { telaEscolher(await rpc("jogadores_publico")); }
  catch (e) { telaAviso("Sem conexão", mensagemErro(e.message), iniciar); }
}

function telaAviso(titulo, texto, tentar) {
  trocarTela(h("section", { class: "tela tela-centro" },
    h("h1", { class: "letreiro grande" }, titulo),
    h("p", { class: "dica-pin" }, texto),
    tentar && h("button", { class: "btn neon", type: "button", onclick: tentar }, "Tentar de novo")));
}

function telaEscolher(jogadores) {
  const rotulo = (j) => (j.configurado ? primeiroNome(j.nome) : j.id === 1 ? "Kevin" : "Mariana");
  const cartao = (j) => h("button", { class: "cartao-pessoa", type: "button", onclick: () => (j.configurado ? telaPin(j) : telaAtivar(j)) },
    h("span", { class: "inicial", "aria-hidden": "true" }, rotulo(j).charAt(0).toUpperCase()),
    h("span", { class: "nome" }, rotulo(j)),
    h("span", { class: "estado" }, j.configurado ? "entrar com PIN" : "ativar perfil"));
  trocarTela(h("section", { class: "tela tela-centro" },
    h("p", { class: "legenda" }, "Bauru · até 100 km · R$ 20 a 600"),
    h("h1", { class: "letreiro grande" }, "Roleta do ", h("em", {}, "Rolê")),
    h("p", { class: "dica-pin" }, "Quem está girando hoje?"),
    h("div", { class: "duo-escolha" }, jogadores.map(cartao))));
}

function telaPin(jogador) {
  const teclado = tecladoPin({
    aoConfirmar: (pin) => acao(null, async () => {
      const r = await rpc("entrar", { p_jogador: jogador.id, p_pin: pin });
      if (r.erro === "pin_errado") return teclado.erro(r.restam ? `PIN errado. Restam ${r.restam} tentativas.` : "PIN errado.");
      if (r.erro) return teclado.erro(mensagemErro(r.erro));
      salvarSessao(r);
      mostrarPainel(await comSessao("painel"), true);
    }),
  });
  trocarTela(h("section", { class: "tela tela-centro" },
    h("span", { class: `inicial ${jogador.id === 2 ? "rosa" : ""}`, "aria-hidden": "true" }, primeiroNome(jogador.nome).charAt(0).toUpperCase()),
    h("h1", { class: "letreiro pequeno" }, `Oi, ${primeiroNome(jogador.nome)}`),
    teclado.el,
    h("button", { class: "btn-texto", type: "button", onclick: iniciar }, "← não sou eu")));
}

// O convite viaja no link (#convite=...): o fragmento não vai pro servidor nem fica em log.
const conviteDoLink = () => new URLSearchParams(location.hash.slice(1)).get("convite") || "";
const limparLink = () => { if (location.hash) history.replaceState(null, "", location.pathname + location.search); };

function telaAtivar(jogador) {
  const convite = h("input", { id: "convite", autocomplete: "off", autocapitalize: "none", spellcheck: "false", value: conviteDoLink(), placeholder: "vem no link que o Kevin mandou" });
  const nome = h("input", { id: "nome", maxlength: "24", autocomplete: "nickname", value: jogador.id === 1 ? "Kevin" : "Mariana", placeholder: "Como você quer aparecer" });
  const aviso = h("p", { class: "aviso", role: "alert" });
  const avancar = (e) => {
    e.preventDefault();
    if (!convite.value.trim()) { aviso.textContent = "Coloque o código do convite."; return; }
    if (!nome.value.trim()) { aviso.textContent = "Coloque seu nome."; return; }
    escolherPin(jogador, nome.value.trim(), convite.value.trim());
  };
  trocarTela(h("section", { class: "tela tela-centro" },
    h("h1", { class: "letreiro pequeno" }, "Ativar perfil"),
    h("p", { class: "dica-pin" }, conviteDoLink() ? "O convite já veio no link. Só confirma seu nome." : "Abra pelo link de convite que o Kevin te mandou. Só precisa fazer isso uma vez."),
    h("form", { class: "pin-caixa", onsubmit: avancar },
      h("label", { class: "campo", for: "convite" }, h("span", {}, "Código do convite"), convite),
      h("label", { class: "campo", for: "nome" }, h("span", {}, "Seu nome"), nome),
      aviso,
      h("button", { class: "btn neon", type: "submit", style: { width: "100%" } }, "Continuar")),
    h("button", { class: "btn-texto", type: "button", onclick: iniciar }, "← voltar")));
}

function escolherPin(jogador, nome, convite) {
  let primeiro = null;
  const titulo = h("h1", { class: "letreiro pequeno" }, "Crie seu PIN");
  const texto = h("p", { class: "dica-pin" }, "De 6 a 8 números. Ele protege o seu sorteio secreto.");
  const teclado = tecladoPin({
    rotuloOk: "ok",
    aoConfirmar: (pin) => {
      if (!primeiro) { primeiro = pin; titulo.textContent = "Repita o PIN"; texto.textContent = "Só pra ter certeza."; teclado.limpar(); return; }
      if (pin !== primeiro) { primeiro = null; titulo.textContent = "Crie seu PIN"; texto.textContent = "De 6 a 8 números."; teclado.erro("Os PINs não bateram. Começa de novo."); return; }
      acao(null, async () => {
        const r = await rpc("reivindicar", { p_jogador: jogador.id, p_nome: nome, p_pin: pin, p_convite: convite });
        if (r.erro) { toast(mensagemErro(r.erro), true); if (r.erro === "convite_invalido") telaAtivar(jogador); else iniciar(); return; }
        salvarSessao(r);
        limparLink();
        confete(24);
        mostrarPainel(await comSessao("painel"), true);
      });
    },
  });
  trocarTela(h("section", { class: "tela tela-centro" }, titulo, texto, teclado.el,
    h("button", { class: "btn-texto", type: "button", onclick: () => telaAtivar(jogador) }, "← voltar")));
}

function salvarSessao(r) {
  est.sessao = { token: r.token, jogador: r.jogador };
  gravarLocal(CHAVE_SESSAO, est.sessao);
}

async function sair() {
  try { await comSessao("sair"); } catch { /* sessão já inválida: só limpa localmente */ }
  gravarLocal(CHAVE_SESSAO, null);
  est.sessao = null; est.painel = null; est.assinatura = "";
  iniciar();
}

// ---------------------------------------------------------------- painel

function mostrarPainel(p, comTransicao = false) {
  est.painel = p;
  est.assinatura = JSON.stringify(p);
  const outro = p.jogadores.find((j) => j.id !== p.eu);
  const blocos = [
    blocoTopo(),
    blocoNos(p, outro),
    blocoPalco(p, outro),
    p.minha_rodada && blocoRecado(p),
    blocoGastos(p),
    blocoHistorico(p),
    blocoContador(p),
    blocoRegras(),
  ].filter(Boolean).map((b, i) => (comTransicao ? entra(b, i) : b));
  const tela = h("section", { class: "tela" }, blocos);
  if (comTransicao) trocarTela(tela); else app.replaceChildren(tela);
}

// ---------------------------------------------------------------- lugares na roleta

const acabando = (p) => p.disponiveis < (p.minimo_lugares ?? 10);

function blocoContador(p) {
  const texto = acabando(p)
    ? "A roleta está acabando e o giro ficou travado. Kevin: peça pro Claude buscar lugares novos."
    : "Lugar visitado volta pra roleta depois de 2 meses e meio.";
  return h("section", { class: `busca ${acabando(p) ? "alerta" : ""}`, "aria-label": "Lugares na roleta" },
    h("p", { class: "busca-numero" }, h("b", {}, String(p.disponiveis)), " lugares na roleta"),
    h("p", { class: "busca-texto" }, texto),
    p.pool_atualizado_em && h("p", { class: "busca-texto fraco" }, `Atualizada em ${dataCurta(p.pool_atualizado_em)}`));
}

function blocoTopo() {
  return h("header", { class: "topo" },
    h("p", { class: "letreiro pequeno" }, "Roleta do ", h("em", {}, "Rolê")),
    h("button", { class: "btn-texto", type: "button", onclick: sair }, "sair"));
}

function blocoNos(p, outro) {
  const [a, b] = p.jogadores;
  const retrato = (j, cls) => h("div", { class: `retrato ${cls} ${p.vez === j.id ? "da-vez" : ""}` },
    j.foto ? h("img", { src: j.foto, alt: primeiroNome(j.nome), width: "138", height: "138" }) : h("span", { class: "inicial" }, primeiroNome(j.nome).charAt(0)));
  const daVez = p.vez === a.id ? a : b;
  return h("section", { class: "nos", "aria-label": "Nós dois" },
    h("div", { class: "dupla" }, retrato(a, "p1"), coracao("#ff5d8f", { class: "coracao" }), retrato(b, "p2")),
    h("p", { class: "nomes" }, `${primeiroNome(a.nome)} & ${primeiroNome(b.nome)}`),
    h("div", { class: "vez", "data-lado": String(daVez.id), role: "status", "aria-label": `Vez de ${primeiroNome(daVez.nome)}` },
      h("i", { class: "trilho", "aria-hidden": "true" }),
      h("span", { class: daVez === a ? "ativo" : "" }, primeiroNome(a.nome)),
      h("span", { class: daVez === b ? "ativo" : "" }, primeiroNome(b.nome))),
    h("p", { class: "vez-texto" }, p.vez === p.eu
      ? h("strong", {}, `Sua vez de levar ${primeiroNome(outro.nome)}`)
      : [h("strong", {}, primeiroNome(outro.nome)), " vai te levar dessa vez"]));
}

function blocoPalco(p, outro) {
  if (p.minha_rodada) return palcoBilhete(p, outro);
  if (p.vez === p.eu) return palcoRoleta(p, outro);
  if (p.rodada_dele) return palcoEnvelope(p, outro);
  return palcoEsperando(outro);
}

function palcoRoleta(p, outro) {
  const roda = new Roda();
  const deficit = Number(p.deficit) || 0;
  let explicacao;
  if (Math.abs(deficit) < 20) explicacao = ["Gastos empatados. A roleta puxa pra rolês perto de ", h("b", {}, brl(p.alvo)), "."];
  else if (deficit > 0) explicacao = [`Você gastou ${brl(deficit)} a menos que ${primeiroNome(outro.nome)}. A roleta puxa pra perto de `, h("b", {}, brl(p.alvo)), "."];
  else explicacao = [`Você gastou ${brl(-deficit)} a mais. A roleta pega mais leve, perto de `, h("b", {}, brl(p.alvo)), "."];

  roda.botao.disabled = acabando(p);
  roda.botao.addEventListener("click", () => acao(roda.botao, async () => {
    const [novo] = await Promise.all([comSessao("girar"), roda.girar()]);
    roda.destruir();
    confete(18);
    mostrarPainel(novo, true);
  }));

  return h("section", { class: "palco", "aria-label": "Roleta" },
    h("p", { class: "titulo-bloco" }, "sua vez de girar"),
    roda.el,
    h("div", { class: "chip-alvo" }, coracao("#ffcf7a", { width: "18" }), h("span", {}, explicacao)),
    h("p", { class: "rodape-palco" }, acabando(p) ? mensagemErro("roleta_acabando") : "Confere se ninguém está espiando a tela."));
}

function palcoBilhete(p, outro) {
  const r = p.minha_rodada, l = r.lugar || {};
  const chave = `roleta.raspado.${r.id}.${l.id}`;
  const linha = (rotulo, valor) => (valor ? [h("dt", {}, rotulo), h("dd", {}, valor)] : []);
  const link = typeof l.link === "string" && l.link.startsWith("https://")
    ? h("a", { href: l.link, target: "_blank", rel: "noopener noreferrer" }, "ver o lugar →") : null;
  const bilhete = h("article", { class: "bilhete" },
    h("div", { class: "bilhete-topo" }, h("span", {}, "só você vê"), h("span", {}, `sorteado ${dataCurta(r.sorteado_em)}`)),
    h("h3", {}, l.nome || "Lugar surpresa"),
    h("div", { class: "etiquetas" },
      h("span", { class: "etiqueta preco" }, l.faixa || `${brl(l.preco)} o casal`),
      l.categoria && h("span", { class: "etiqueta" }, l.categoria),
      h("span", { class: "etiqueta" }, l.cidade === "Bauru" ? "Bauru" : `${l.cidade} · ${l.distancia_km} km`)),
    h("div", { class: "bilhete-picote" }),
    l.descricao && h("p", {}, l.descricao),
    h("dl", {}, linha("O que fazer", l.o_que_fazer), linha("Endereço", l.endereco), linha("Horário", l.horario), linha("Dica", l.dica)),
    link,
    h("p", { class: "ressalva" }, "Preço e horário são estimativas da pesquisa. Confirme antes de ir."));
  const caixa = h("div", { class: "bilhete-caixa" }, bilhete);
  if (!lerLocal(chave)) raspadinha(caixa, () => { gravarLocal(chave, true); confete(14); });

  const restam = Math.max(0, 2 - (r.regiros || 0));
  const feito = h("button", { class: "btn rosa", type: "button", onclick: () => folhaConcluir(outro) }, "Rolê feito ♥");
  const regirar = h("button", { class: "btn", type: "button", disabled: !restam }, `Girar de novo (${restam})`);
  regirar.addEventListener("click", () => acao(regirar, async () => mostrarPainel(await comSessao("regirar"), true)));
  const cancelar = h("button", { class: "btn fantasma", type: "button", onclick: folhaCancelar }, "Cancelar");
  const restamFechado = Math.max(0, 3 - (r.fechados || 0));
  const fechado = h("button", { class: "btn-fechado", type: "button", disabled: !restamFechado, onclick: () => folhaFechado(restamFechado) },
    restamFechado ? "Lugar fechado? Rodar de novo" : "Sem mais trocas por lugar fechado nesta rodada");

  return h("section", { class: "palco", "aria-label": "Seu rolê secreto" },
    h("p", { class: "titulo-bloco" }, "seu rolê secreto"),
    caixa,
    h("div", { class: "acoes" }, feito, regirar, cancelar),
    fechado);
}

function folhaFechado(restam) {
  const sim = h("button", { class: "btn neon", type: "button" }, "Rodar de novo");
  let fechar = () => {};
  sim.addEventListener("click", () => acao(sim, async () => {
    const novo = await comSessao("lugar_fechado");
    fechar();
    toast("Lugar tirado da roleta. Raspa o bilhete novo ♥");
    mostrarPainel(novo, true);
  }));
  fechar = folha([
    h("h2", {}, "Lugar fechado?"),
    h("p", {}, `Se o lugar fechou, mudou ou não está funcionando, ele sai da roleta e a gente sorteia outro na hora, sem gastar as suas trocas. Você ainda pode fazer isso ${restam} ${restam === 1 ? "vez" : "vezes"} nesta rodada.`),
    h("div", { class: "acoes" }, sim, h("button", { class: "btn fantasma", type: "button", onclick: () => fechar() }, "Voltar")),
  ]);
}

function palcoEnvelope(p, outro) {
  const r = p.rodada_dele;
  const envelope = h("button", { class: "envelope", type: "button", "aria-label": "Abrir o recado" },
    h("div", { class: "env-carta" },
      h("p", { class: "mao" }, r.dica || "Sem dica ainda…"),
      r.quando && h("p", {}, h("b", {}, "Quando: "), r.quando),
      h("p", { style: { fontSize: "12px", color: "#8a5a3c" } }, `de ${primeiroNome(outro.nome)}, com carinho`)),
    h("div", { class: "env-corpo" }),
    h("div", { class: "env-aba" }, h("div", { class: "lacre" }, coracao("#ffd0de", { width: "22" }))));
  const legenda = h("p", { class: "env-legenda" }, "toque pra abrir o recado");
  envelope.addEventListener("click", () => {
    const aberto = envelope.classList.toggle("aberto");
    legenda.textContent = aberto ? "o lugar continua segredo até o dia" : "toque pra abrir o recado";
  });
  return h("section", { class: "palco", "aria-label": "Surpresa em andamento" },
    h("p", { class: "titulo-bloco rosa" }, `${primeiroNome(outro.nome)} já sorteou`),
    envelope, legenda);
}

function palcoEsperando(outro) {
  return h("section", { class: "palco", "aria-label": "Esperando" },
    h("p", { class: "titulo-bloco rosa" }, "esperando o giro"),
    h("div", { class: "orbita" }, outro.foto ? h("img", { src: outro.foto, alt: "" }) : h("span", { class: "inicial" }, primeiroNome(outro.nome).charAt(0)), h("i", {})),
    h("p", { class: "palco-texto" }, `${primeiroNome(outro.nome)} ainda não girou a roleta.`),
    h("p", { class: "palco-texto fraco" }, "Quando girar, o recado aparece aqui num envelope."));
}

function blocoRecado(p) {
  const r = p.minha_rodada;
  const dica = h("input", { id: "dica", maxlength: "140", value: r.dica || "", placeholder: "ex: vai de tênis e leva casaco" });
  const quando = h("input", { id: "quando", maxlength: "40", value: r.quando || "", placeholder: "ex: sábado, 19h" });
  const salvar = h("button", { class: "btn neon", type: "submit" }, "Mandar recado");
  const enviar = (e) => {
    e.preventDefault();
    acao(salvar, async () => {
      mostrarPainel(await comSessao("recado", { p_dica: dica.value, p_quando: quando.value }));
      toast("Recado entregue no envelope ♥");
    });
  };
  return h("form", { class: "palco recado", "aria-label": "Recado", onsubmit: enviar },
    h("p", { class: "titulo-bloco" }, "recado pro envelope"),
    h("label", { class: "campo", for: "dica" }, h("span", {}, "Dica sem entregar o lugar"), dica),
    h("label", { class: "campo", for: "quando" }, h("span", {}, "Quando"), quando),
    salvar);
}

function blocoGastos(p) {
  const pessoas = p.jogadores.map((j) => ({ nome: primeiroNome(j.nome), foto: j.foto, total: Number(p.gastos?.[j.id]) || 0 }));
  const [a, b] = pessoas;
  const diff = Math.abs(a.total - b.total);
  const veredito = diff < 20 ? "Equilibrado. Ninguém está devendo." : `${(a.total < b.total ? a : b).nome} está ${brl(diff)} atrás. A roleta compensa.`;
  return h("section", { class: "palco gangorra", "aria-label": "Quem já gastou quanto" },
    h("p", { class: "titulo-bloco" }, "a gangorra dos gastos"),
    gangorra(pessoas, brl),
    h("div", { class: "valores" },
      h("div", { class: "valor" }, h("span", {}, a.nome), h("b", {}, brl(a.total))),
      h("div", { class: "valor" }, h("span", {}, b.nome), h("b", {}, brl(b.total)))),
    h("p", { class: "veredito" }, veredito));
}

function blocoHistorico(p) {
  const pessoa = (id) => p.jogadores.find((j) => j.id === id) || {};
  const itens = (p.historico || []).map((x) => h("figure", { class: "polaroid", style: { margin: "0" } },
    h("div", { class: "polaroid-foto" }, (x.nome || "?").charAt(0), pessoa(x.quem_leva).foto && h("img", { src: pessoa(x.quem_leva).foto, alt: "" })),
    h("figcaption", {},
      h("p", { class: "legenda-mao" }, x.nome),
      h("p", { class: "meta" }, h("span", {}, `${primeiroNome(pessoa(x.quem_leva).nome)} levou · ${dataCurta(x.feito_em)}`), h("b", {}, brl(x.valor))))));
  return h("section", { class: "palco", "aria-label": "Rolês que já rolaram" },
    h("p", { class: "titulo-bloco" }, "nosso álbum"),
    itens.length ? h("div", { class: "carrossel" }, itens) : h("p", { class: "vazio" }, "Nenhum rolê ainda. A primeira polaroid aparece aqui depois do primeiro rolê."));
}

function blocoRegras() {
  return h("details", { class: "regras" },
    h("summary", {}, "Como funciona"),
    h("ol", {},
      h("li", {}, "Antes de acabar, o Kevin pede pro Claude atualizar a roleta. Com menos de 10 lugares o giro trava até lá."),
      h("li", {}, "Na sua vez, gire e raspe o bilhete. Só você vê o lugar."),
      h("li", {}, "Se não der (fechado, lotado), gire de novo até 2 vezes."),
      h("li", {}, "Deixe um recado no envelope: a dica de roupa e o horário."),
      h("li", {}, "Depois do rolê, toque em \"Rolê feito\" e coloque quanto gastou. A vez passa."),
      h("li", {}, "A gangorra compara os gastos: quem gastou menos cai em rolês mais caros, até empatar."),
      h("li", {}, "Lugar visitado só volta pra roleta depois de 2 meses e meio.")));
}

// ---------------------------------------------------------------- folhas

function folhaConcluir(outro) {
  const valor = h("input", { id: "valor", inputmode: "decimal", autocomplete: "off", placeholder: "0" });
  const confirmar = h("button", { class: "btn rosa", type: "submit" }, "Confirmar e passar a vez");
  let fechar = () => {};
  const enviar = (e) => {
    e.preventDefault();
    const v = lerValor(valor.value);
    if (v == null) { toast(mensagemErro("valor_invalido"), true); return; }
    acao(confirmar, async () => {
      const novo = await comSessao("concluir", { p_valor: v });
      fechar();
      confete(40);
      toast(`Rolê guardado no álbum! Agora é a vez de ${primeiroNome(outro.nome)}.`);
      mostrarPainel(novo, true);
    });
  };
  const form = h("form", { onsubmit: enviar, style: { display: "flex", flexDirection: "column", gap: "16px" } },
    h("h2", {}, "Como foi?"),
    h("p", {}, `Coloque quanto você pagou no total. O lugar entra no álbum e a vez passa pra ${primeiroNome(outro.nome)}.`),
    h("label", { class: "valor-grande", for: "valor" }, h("span", {}, "R$"), valor),
    h("div", { class: "acoes" }, confirmar, h("button", { class: "btn fantasma", type: "button", onclick: () => fechar() }, "Voltar")));
  fechar = folha(form);
}

function folhaCancelar() {
  const sim = h("button", { class: "btn neon", type: "button" }, "Cancelar sorteio");
  let fechar = () => {};
  sim.addEventListener("click", () => acao(sim, async () => {
    const novo = await comSessao("cancelar");
    fechar();
    mostrarPainel(novo, true);
  }));
  fechar = folha([
    h("h2", {}, "Cancelar?"),
    h("p", {}, "O lugar volta pra roleta e você gira de novo do zero. Continua sendo sua vez."),
    h("div", { class: "acoes" }, sim, h("button", { class: "btn fantasma", type: "button", onclick: () => fechar() }, "Voltar")),
  ]);
}

// ---------------------------------------------------------------- atualização em segundo plano

function podeAtualizar() {
  if (!est.sessao?.token || !est.painel || est.ocupado || folhaAberta()) return false;
  if (document.visibilityState !== "visible") return false;
  if (document.activeElement instanceof HTMLInputElement) return false;
  return !document.querySelector(".raspa:not(.some), .envelope.aberto, .roda-caixa.girando");
}

async function atualizarSilencioso() {
  if (!podeAtualizar()) return;
  try {
    const p = await comSessao("painel");
    if (JSON.stringify(p) !== est.assinatura && podeAtualizar()) mostrarPainel(p, true);
  } catch { /* tenta de novo no próximo ciclo */ }
}

setInterval(atualizarSilencioso, ATUALIZA_MS);
document.addEventListener("visibilitychange", atualizarSilencioso);
iniciar();

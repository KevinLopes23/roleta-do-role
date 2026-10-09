// Componentes visuais da Roleta do Rolê. Nenhum deles fala com o banco.

const SVG_NS = "http://www.w3.org/2000/svg";
export const movimentoReduzido = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Cria um elemento. Texto sempre via textContent (nada de innerHTML com dado de usuário). */
export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  aplicarAttrs(el, attrs);
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false && f !== "") el.append(f instanceof Node ? f : String(f));
  return el;
}

export function s(tag, attrs = {}, ...filhos) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const f of filhos.flat()) if (f) el.append(f);
  return el;
}

function aplicarAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") Object.assign(el.style, v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
}

export const coracao = (cor = "#ff5d8f", attrs = {}) =>
  s("svg", { viewBox: "0 0 32 30", "aria-hidden": "true", ...attrs },
    s("path", { fill: cor, d: "M16 29s-1-.6-2.6-1.8C8.2 23.3 1 17.4 1 9.7 1 5 4.6 1.5 8.9 1.5c2.9 0 5.4 1.6 7.1 4 1.7-2.4 4.2-4 7.1-4C27.4 1.5 31 5 31 9.7c0 7.7-7.2 13.6-12.4 17.5C17 28.4 16 29 16 29z" }));

// ---------------------------------------------------------------- roleta

const CORES_FATIAS = ["#7a1f3d", "#ffcf7a", "#3b1626", "#ff5d8f", "#4a2412", "#ff9a5c"];
const FATIAS = 12;
const LAMPADAS = 28;

export class Roda {
  constructor() {
    this.angulo = Math.random() * Math.PI * 2;
    this.canvas = h("canvas", { "aria-hidden": "true" });
    this.botao = h("button", { class: "roda-centro", type: "button" }, "girar");
    this.ponteiro = s("svg", { class: "roda-ponteiro", viewBox: "0 0 40 44", "aria-hidden": "true" },
      s("path", { fill: "#ff5d8f", d: "M20 43C20 43 3 27 3 14.5 3 7 9 1.5 15 1.5c2.2 0 3.8 1 5 2.5 1.2-1.5 2.8-2.5 5-2.5 6 0 12 5.5 12 13C37 27 20 43 20 43z" }),
      s("circle", { cx: 20, cy: 15, r: 4, fill: "#ffe3ad" }));
    this.el = h("div", { class: "roda-caixa" }, this.ponteiro, this.canvas, this.botao);
    // Desenha quando o canvas ganha tamanho (entra na tela, gira o celular) e quando a fonte carrega.
    this.observador = new ResizeObserver(() => this.desenhar());
    this.observador.observe(this.canvas);
    document.fonts?.ready.then(() => this.desenhar());
  }

  desenhar(acesas = -1) {
    const lado = this.canvas.clientWidth;
    if (!lado) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(lado * dpr)) { this.canvas.width = Math.round(lado * dpr); this.canvas.height = Math.round(lado * dpr); }
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, lado, lado);
    const r = lado / 2, aro = lado * 0.07, raio = r - aro, fatia = (Math.PI * 2) / FATIAS;

    ctx.save(); ctx.translate(r, r);
    ctx.shadowColor = "rgba(255,170,80,.55)"; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(0, 0, r - 3, 0, Math.PI * 2); ctx.fillStyle = "#1b0f14"; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,207,122,.6)"; ctx.stroke();

    ctx.rotate(this.angulo);
    for (let i = 0; i < FATIAS; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, raio, i * fatia, (i + 1) * fatia); ctx.closePath();
      const cor = CORES_FATIAS[i % CORES_FATIAS.length];
      const g = ctx.createRadialGradient(0, 0, raio * 0.2, 0, 0, raio);
      g.addColorStop(0, cor); g.addColorStop(1, sombrear(cor));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = "rgba(12,8,9,.55)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.save(); ctx.rotate(i * fatia + fatia / 2);
      ctx.fillStyle = claro(cor) ? "#3a1420" : "#ffe3ad";
      ctx.font = `${Math.round(lado / 10)}px Yellowtail, cursive`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(i % 3 === 0 ? "♥" : "?", raio * 0.72, 2);
      ctx.restore();
    }
    ctx.rotate(-this.angulo);

    for (let i = 0; i < LAMPADAS; i++) {
      const a = (i / LAMPADAS) * Math.PI * 2;
      const acesa = acesas < 0 ? i % 2 === 0 : (i + acesas) % 4 === 0;
      ctx.beginPath(); ctx.arc(Math.cos(a) * (r - aro / 2 - 2), Math.sin(a) * (r - aro / 2 - 2), lado * 0.011, 0, Math.PI * 2);
      ctx.fillStyle = acesa ? "#ffe3ad" : "rgba(255,207,122,.25)";
      ctx.shadowColor = acesa ? "rgba(255,200,120,1)" : "transparent"; ctx.shadowBlur = acesa ? 10 : 0;
      ctx.fill();
    }
    ctx.restore();
  }

  /** Gira por `duracao` ms; resolve quando para. */
  girar(duracao = 3600) {
    if (movimentoReduzido()) return Promise.resolve();
    this.el.classList.add("girando");
    const inicio = this.angulo, alvo = inicio + Math.PI * 2 * (6 + Math.random() * 3), t0 = performance.now();
    return new Promise((ok) => {
      const passo = (t) => {
        const p = Math.min(1, (t - t0) / duracao);
        this.angulo = inicio + (alvo - inicio) * (1 - Math.pow(1 - p, 4));
        this.desenhar(Math.floor(t / 90));
        if (p < 1) requestAnimationFrame(passo);
        else { this.el.classList.remove("girando"); this.desenhar(); ok(); }
      };
      requestAnimationFrame(passo);
    });
  }

  destruir() { this.observador.disconnect(); }
}

function sombrear(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * 0.55).toString(16).padStart(2, "0");
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
const claro = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150; };

// ---------------------------------------------------------------- raspadinha

/** Cobre `alvo` com uma camada dourada que se raspa com o dedo. Chama `aoRevelar` ao passar de 45%. */
export function raspadinha(alvo, aoRevelar) {
  const canvas = h("canvas", { class: "raspa", "aria-label": "Raspe para revelar o lugar", role: "img" });
  const dica = h("div", { class: "raspa-dica" }, "raspa aqui ♥");
  const pular = h("button", { class: "btn fantasma", type: "button", style: { position: "absolute", top: "10px", right: "10px", zIndex: "5", padding: "6px 12px", fontSize: "12px", color: "#4a2410" } }, "revelar");
  let revelado = false, ultimo = null, contador = 0;

  const revelar = () => {
    if (revelado) return;
    revelado = true;
    canvas.classList.add("some"); dica.classList.add("some"); pular.remove();
    setTimeout(() => { canvas.remove(); dica.remove(); }, 800);
    aoRevelar?.();
  };

  const pintar = () => {
    const { width: w, height: alt } = alvo.getBoundingClientRect();
    if (!w) return requestAnimationFrame(pintar);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(alt * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const g = ctx.createLinearGradient(0, 0, w, alt);
    g.addColorStop(0, "#e9b75c"); g.addColorStop(0.45, "#ffe3ad"); g.addColorStop(0.55, "#f3c46e"); g.addColorStop(1, "#b9843a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, alt);
    ctx.globalAlpha = 0.18; ctx.fillStyle = "#7a4a14";
    for (let i = 0; i < 260; i++) ctx.fillRect(Math.random() * w, Math.random() * alt, 2, 2);
    ctx.globalAlpha = 0.3; ctx.font = "34px Yellowtail, cursive"; ctx.fillStyle = "#7a1f3d"; ctx.textAlign = "center";
    for (let y = 50; y < alt; y += 70) for (let x = (y / 70) % 2 ? 40 : 90; x < w; x += 110) ctx.fillText("♥", x, y);
    ctx.globalAlpha = 1;
  };

  const ponto = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let raspando = false;
  const raspar = (e) => {
    if (revelado || !raspando) return;
    const ctx = canvas.getContext("2d"), p = ponto(e);
    ctx.globalCompositeOperation = "destination-out"; ctx.lineWidth = 46; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo((ultimo || p).x, (ultimo || p).y); ctx.lineTo(p.x + 0.1, p.y); ctx.stroke();
    ultimo = p;
    dica.classList.add("some");
    if (++contador % 12 === 0 && fracaoLimpa(canvas) > 0.45) revelar();
  };
  canvas.addEventListener("pointerdown", (e) => { raspando = true; canvas.setPointerCapture(e.pointerId); ultimo = null; raspar(e); });
  canvas.addEventListener("pointermove", raspar);
  const soltar = () => { raspando = false; ultimo = null; if (!revelado && fracaoLimpa(canvas) > 0.45) revelar(); };
  canvas.addEventListener("pointerup", soltar);
  canvas.addEventListener("pointercancel", soltar);
  pular.addEventListener("click", revelar);

  alvo.append(canvas, dica, pular);
  requestAnimationFrame(pintar);
}

function fracaoLimpa(canvas) {
  const { width: w, height: alt } = canvas;
  if (!w || !alt) return 0;
  const dados = canvas.getContext("2d").getImageData(0, 0, w, alt).data;
  let limpos = 0, total = 0;
  for (let i = 3; i < dados.length; i += 4 * 40) { total++; if (dados[i] < 40) limpos++; }
  return limpos / total;
}

// ---------------------------------------------------------------- gangorra dos gastos

/** Gangorra SVG: quem gastou mais desce. `pessoas` = [{nome, foto, total}, {…}] */
export function gangorra(pessoas, brl) {
  const [a, b] = pessoas;
  const angulo = Math.max(-11, Math.min(11, ((b.total || 0) - (a.total || 0)) / 18));
  const assento = (p, x, id, cor) => s("g", {},
    s("clipPath", { id }, s("circle", { cx: x, cy: 78, r: 26 })),
    s("circle", { cx: x, cy: 78, r: 29, fill: "#0c0809", stroke: cor, "stroke-width": 2 }),
    p.foto ? s("image", { href: p.foto, x: x - 26, y: 52, width: 52, height: 52, "clip-path": `url(#${id})`, preserveAspectRatio: "xMidYMid slice" }) : null);
  const barra = s("g", { class: "barra" },
    s("rect", { x: 22, y: 107, width: 276, height: 10, rx: 5, fill: "url(#madeira)" }),
    assento(a, 52, "g-a", "#ffcf7a"), assento(b, 268, "g-b", "#ff5d8f"));
  const svg = s("svg", { viewBox: "0 -24 320 194", role: "img", "aria-label": `${a.nome} gastou ${brl(a.total)} e ${b.nome} gastou ${brl(b.total)}` },
    s("defs", {}, s("linearGradient", { id: "madeira", x1: 0, x2: 1 },
      s("stop", { offset: "0", "stop-color": "#ffcf7a" }), s("stop", { offset: ".5", "stop-color": "#ff9a5c" }), s("stop", { offset: "1", "stop-color": "#ff5d8f" }))),
    s("ellipse", { cx: 160, cy: 160, rx: 120, ry: 6, fill: "rgba(255,170,80,.12)" }),
    s("path", { d: "M160 112 L136 160 L184 160 Z", fill: "#2e1d26", stroke: "rgba(255,207,122,.5)", "stroke-width": 1.5 }),
    barra,
    s("circle", { cx: 160, cy: 112, r: 5, fill: "#ffe3ad" }));
  requestAnimationFrame(() => requestAnimationFrame(() => { barra.style.transform = `rotate(${angulo}deg)`; }));
  return svg;
}

// ---------------------------------------------------------------- efeitos

export function confete(qtd = 34) {
  if (movimentoReduzido()) return;
  const cores = ["#ff5d8f", "#ffcf7a", "#ff9a5c", "#ffd0de"];
  for (let i = 0; i < qtd; i++) {
    const el = coracao(cores[i % cores.length], { class: "confete", width: String(Math.round(14 + Math.random() * 16)) });
    el.style.left = `${50 + (Math.random() - 0.5) * 20}vw`;
    el.style.top = "62vh";
    document.body.append(el);
    const dx = (Math.random() - 0.5) * 120, dy = -(40 + Math.random() * 50), giro = (Math.random() - 0.5) * 540;
    el.animate([
      { transform: "translate(0,0) rotate(0) scale(.4)", opacity: 1 },
      { transform: `translate(${dx}vw, ${dy}vh) rotate(${giro}deg) scale(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${dx * 1.2}vw, ${dy * 0.6}vh) rotate(${giro * 1.4}deg) scale(.8)`, opacity: 0 },
    ], { duration: 1800 + Math.random() * 900, easing: "cubic-bezier(.16,1,.3,1)" }).onfinish = () => el.remove();
  }
}

let toastTimer;
export function toast(msg, erro = false) {
  let el = document.querySelector(".toast");
  if (!el) { el = h("div", { class: "toast", role: "status" }); document.body.append(el); }
  el.textContent = msg;
  el.classList.toggle("erro", erro);
  requestAnimationFrame(() => el.classList.add("mostra"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("mostra"), 3600);
}

/** Folha que sobe de baixo. Retorna `fechar`. */
export function folha(conteudo) {
  const camada = document.getElementById("camada");
  const fundo = h("div", { class: "fundo-folha" });
  const painel = h("div", { class: "folha", role: "dialog", "aria-modal": "true" }, conteudo);
  camada.replaceChildren(fundo, painel);
  const esc = (e) => { if (e.key === "Escape") fechar(); };
  function fechar() {
    camada.classList.remove("ativa");
    document.removeEventListener("keydown", esc);
    setTimeout(() => { if (!camada.classList.contains("ativa")) camada.replaceChildren(); }, 500);
  }
  fundo.addEventListener("click", fechar);
  document.addEventListener("keydown", esc);
  requestAnimationFrame(() => { camada.classList.add("ativa"); painel.querySelector("input, button")?.focus(); });
  return fechar;
}

export const folhaAberta = () => document.getElementById("camada").classList.contains("ativa");

// ---------------------------------------------------------------- nota em corações

/** Cinco corações clicáveis. `valor` 0–5; `aoEscolher(n)` recebe 1–5. */
export function notaCoracoes(valor, aoEscolher, rotulo) {
  const botoes = [1, 2, 3, 4, 5].map((n) => {
    const b = h("button", { class: `nota-coracao ${n <= valor ? "on" : ""}`, type: "button", "aria-label": `${n} de 5`, "aria-pressed": String(n === valor) },
      coracao(n <= valor ? "#ff5d8f" : "rgba(255,93,143,.25)", { width: "20" }));
    b.addEventListener("click", (e) => { e.stopPropagation(); aoEscolher(n); });
    return b;
  });
  return h("div", { class: "notas", role: "group", "aria-label": rotulo }, h("span", { class: "notas-rotulo" }, rotulo), h("div", { class: "notas-botoes" }, botoes));
}

// ---------------------------------------------------------------- foto do rolê

const FOTO_LADO = 1000;
const FOTO_MAX = 380000; // caracteres do data URL (o banco aceita até 400 mil)

/** Reduz e comprime a foto no próprio celular: devolve um data URL JPEG pequeno. */
export async function comprimirFoto(arquivo) {
  let imagem;
  try { imagem = await createImageBitmap(arquivo); }
  catch { throw new Error("foto_ilegivel"); }
  for (const [lado, qualidade] of [[FOTO_LADO, 0.78], [900, 0.68], [760, 0.6], [640, 0.55]]) {
    const escala = Math.min(1, lado / Math.max(imagem.width, imagem.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(imagem.width * escala);
    canvas.height = Math.round(imagem.height * escala);
    canvas.getContext("2d").drawImage(imagem, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", qualidade);
    if (dataUrl.length <= FOTO_MAX) return dataUrl;
  }
  throw new Error("foto_invalida");
}

// ---------------------------------------------------------------- teclado de PIN

const PIN_MIN = 6;
const PIN_MAX = 8;

/** Teclado numérico próprio. `aoConfirmar(pin)` recebe 6–8 dígitos. Retorna {el, erro(msg), limpar()} */
export function tecladoPin({ rotuloOk = "entrar", aoConfirmar }) {
  let pin = "";
  const pontos = h("div", { class: "pontos", "aria-hidden": "true" });
  const aviso = h("p", { class: "aviso", role: "alert" });
  const ok = h("button", { class: "tecla ok", type: "button", disabled: true }, rotuloOk);
  const atualizar = () => {
    pontos.replaceChildren(...Array.from({ length: Math.max(PIN_MIN, pin.length) }, (_, i) => h("i", { class: i < pin.length ? "cheio" : "" })));
    ok.disabled = pin.length < PIN_MIN;
  };
  const digitar = (d) => { if (pin.length < PIN_MAX) { pin += d; aviso.textContent = ""; atualizar(); } };
  const apagar = () => { pin = pin.slice(0, -1); atualizar(); };
  const confirmar = () => { if (pin.length >= PIN_MIN) aoConfirmar(pin); };
  const tecla = (d) => h("button", { class: "tecla", type: "button", onclick: () => digitar(d), "aria-label": `dígito ${d}` }, d);
  const teclado = h("div", { class: "teclado" },
    ..."123456789".split("").map(tecla),
    h("button", { class: "tecla acao", type: "button", onclick: apagar, "aria-label": "apagar" }, "apagar"),
    tecla("0"), ok);
  ok.addEventListener("click", confirmar);
  const el = h("div", { class: "pin-caixa" }, pontos, aviso, teclado);
  const teclas = (e) => {
    if (!el.isConnected) return document.removeEventListener("keydown", teclas);
    if (e.target instanceof HTMLInputElement) return;
    if (/^\d$/.test(e.key)) digitar(e.key);
    else if (e.key === "Backspace") apagar();
    else if (e.key === "Enter") confirmar();
  };
  document.addEventListener("keydown", teclas);
  atualizar();
  return {
    el,
    erro(msg) { aviso.textContent = msg; pontos.classList.remove("erro"); void pontos.offsetWidth; pontos.classList.add("erro"); pin = ""; atualizar(); navigator.vibrate?.(120); },
    limpar() { pin = ""; aviso.textContent = ""; atualizar(); },
  };
}

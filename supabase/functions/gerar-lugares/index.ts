// Edge Function: busca lugares novos com o Claude (pesquisa na web) e grava na roleta.
// O site chama com o token de sessão; o banco decide se pode (intervalo, sessão) e valida cada lugar.
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ORIGENS = ["https://kevinlopes23.github.io", "http://localhost:5173"];
const MODELO = "claude-opus-5-5";
const QUANTOS = 8;
const MAX_BUSCAS = 8;
const MAX_CONTINUACOES = 4;
const TIMEOUT_MS = 130_000; // o plano grátis do Supabase encerra a função em 150 s

const SISTEMA = `Você pesquisa programas pagos para um casal que mora em Bauru-SP (ele leva ela, ela leva ele).
Use a pesquisa na web para encontrar lugares REAIS e funcionando hoje, com informações conferidas em fontes atuais
(site oficial, Instagram, Google, guias locais, matérias recentes). Nunca invente lugar, endereço, horário ou preço.`;

type Contexto = { existentes: string[]; disponiveis: number };

const pedido = (ctx: Contexto) => `Encontre ${QUANTOS} lugares novos para a roleta de rolês do casal.

Regras:
- Pelo menos ${Math.ceil(QUANTOS * 0.6)} em Bauru; os outros a até 100 km de Bauru (Agudos, Jaú, Lençóis Paulista, Pederneiras, Barra Bonita, Botucatu, Garça, Marília…).
- Programa pago com total do CASAL entre R$ 20 e R$ 600 (estimativa realista com consumo normal).
- Varie bastante: restaurantes de vários tipos, bares com música, cafés, experiências (escape, kart, boliche, aulas, degustação), passeios, natureza, cultura, eventos fixos.
- Não repita nenhum destes que já estão na roleta: ${ctx.existentes.join("; ") || "(nenhum)"}.
- distancia_km: 0 para Bauru, senão a distância aproximada de carro.
- Textos curtos em português. link: página oficial ou Instagram (https), ou "" se não tiver.

Quando terminar a pesquisa, chame a ferramenta salvar_lugares uma vez com todos os lugares.`;

const SALVAR_LUGARES = {
  name: "salvar_lugares",
  description: "Grava na roleta os lugares encontrados na pesquisa. Chame uma vez, no fim, com a lista completa.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["lugares"],
    properties: {
      lugares: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nome", "cidade", "distancia_km", "categoria", "preco", "faixa", "descricao", "o_que_fazer", "endereco", "horario", "dica", "link"],
          properties: {
            nome: { type: "string" },
            cidade: { type: "string" },
            distancia_km: { type: "integer", description: "0 para Bauru" },
            categoria: { type: "string", description: "ex.: Japonês, Bar com música ao vivo, Escape room" },
            preco: { type: "integer", description: "estimativa do total do casal em reais, entre 20 e 600" },
            faixa: { type: "string", description: "ex.: ~R$ 120–160 o casal" },
            descricao: { type: "string" },
            o_que_fazer: { type: "string" },
            endereco: { type: "string" },
            horario: { type: "string" },
            dica: { type: "string" },
            link: { type: "string", description: "https ou vazio" },
          },
        },
      },
    },
  },
};

const WEB_SEARCH = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: MAX_BUSCAS,
  user_location: { type: "approximate", city: "Bauru", region: "São Paulo", country: "BR", timezone: "America/Sao_Paulo" },
};

function cabecalhos(origem: string) {
  return {
    "Access-Control-Allow-Origin": ORIGENS.includes(origem) ? origem : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

const responder = (status: number, corpo: unknown, origem: string) =>
  new Response(JSON.stringify(corpo), { status, headers: cabecalhos(origem) });

async function rpc(fn: string, args: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const corpo = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(String(corpo?.message ?? `rpc ${fn} ${resp.status}`));
  return corpo;
}

async function buscarLugares(ctx: Contexto): Promise<unknown[]> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY"), timeout: TIMEOUT_MS, maxRetries: 0 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: pedido(ctx) }];
  for (let i = 0; i <= MAX_CONTINUACOES; i++) {
    const resp = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SISTEMA,
      tools: [WEB_SEARCH, SALVAR_LUGARES],
      messages,
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    const salvar = resp.content.find((b) => b.type === "tool_use" && b.name === "salvar_lugares");
    if (salvar && salvar.type === "tool_use") {
      const lugares = (salvar.input as { lugares?: unknown }).lugares;
      if (Array.isArray(lugares)) return lugares;
      throw new Error("resposta sem lista de lugares");
    }
    if (resp.stop_reason === "refusal") throw new Error("pedido recusado pelo modelo");
    if (resp.stop_reason === "max_tokens") throw new Error("resposta cortada (max_tokens)");
    // pause_turn: devolve o conteúdo e o modelo continua; end_turn sem salvar: pede a chamada da ferramenta.
    messages.push({ role: "assistant", content: resp.content });
    if (resp.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: "Agora chame salvar_lugares com os lugares que você encontrou." });
    }
  }
  throw new Error("o modelo não chamou salvar_lugares");
}

async function gerar(ctx: Contexto) {
  try {
    const lugares = await buscarLugares(ctx);
    const r = await rpc("geracao_salvar", { p_lugares: lugares });
    console.log(`gerar-lugares: ${r?.novos} novos de ${lugares.length} sugeridos`);
  } catch (e) {
    console.error("gerar-lugares falhou:", e);
    const curta = e instanceof Anthropic.APIError ? `API ${e.status ?? ""}`.trim() : String((e as Error)?.message ?? e);
    await rpc("geracao_falhou", { p_msg: `A busca falhou (${curta}). Tente de novo mais tarde.` }).catch(() => {});
  }
}

Deno.serve(async (req) => {
  const origem = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS") return new Response(null, { headers: cabecalhos(origem) });
  if (req.method !== "POST") return responder(405, { erro: "metodo" }, origem);

  let token: unknown;
  try { ({ token } = await req.json()); } catch { return responder(400, { erro: "json" }, origem); }
  if (typeof token !== "string" || token.length > 100) return responder(400, { erro: "token" }, origem);

  let ctx: Contexto;
  try {
    ctx = await rpc("geracao_iniciar", { p_token: token });
  } catch (e) {
    const codigo = (e as Error).message;
    return responder(codigo === "geracao_cedo" ? 429 : 401, { erro: codigo }, origem);
  }

  // Responde na hora e continua a busca em segundo plano; o site acompanha pelo painel.
  // @ts-ignore EdgeRuntime existe no runtime do Supabase
  EdgeRuntime.waitUntil(gerar(ctx));
  return responder(202, { ok: true }, origem);
});

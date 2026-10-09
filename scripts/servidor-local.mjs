// Servidor de desenvolvimento: arquivos estáticos + RPCs simuladas com PGlite (como o PostgREST do Supabase faria).
//   node scripts/servidor-local.mjs [porta]
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const RAIZ = fileURLToPath(new URL("../", import.meta.url));
const PORTA = Number(process.argv[2]) || 5173;
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const FUNCOES = new Set(["jogadores_publico", "reivindicar", "entrar", "painel", "girar", "regirar", "recado", "concluir", "cancelar", "sair", "lugar_fechado", "avaliar", "vetos_salvar", "foto_salvar", "foto"]);

const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec("create schema extensions; create role anon nologin; create role authenticated nologin;");
await db.exec(readFileSync(join(RAIZ, "supabase/schema.sql"), "utf8"));
const privado = join(RAIZ, "supabase/seed-privado.sql");
// DEMO=1: perfis de demonstração (avatar com a inicial, sem fotos reais) para capturas de tela públicas. Convite: "demo".
const avatar = (letra, cor) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><radialGradient id="g" cx="40%" cy="35%"><stop offset="0" stop-color="${cor}"/><stop offset="1" stop-color="#1a0d13"/></radialGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="128" font-family="Georgia, serif" font-style="italic" font-size="96" fill="#fff4e2" text-anchor="middle">${letra}</text></svg>`);
if (process.env.DEMO) await db.exec(`insert into jogadores (id, nome, foto) values (1, 'Kevin', '${avatar("K", "#b8862e")}'), (2, 'Mariana', '${avatar("M", "#c2335f")}');
  insert into config (id, convite_hash) values (1, extensions.crypt('demo', extensions.gen_salt('bf')));`);
else if (existsSync(privado)) await db.exec(readFileSync(privado, "utf8"));
else await db.exec("insert into jogadores (id, nome) values (1, 'Kevin'), (2, 'Ela'); insert into config (id, convite_hash) values (1, extensions.crypt('teste', extensions.gen_salt('bf')));");
await db.exec(readFileSync(join(RAIZ, "supabase/seed-lugares.sql"), "utf8"));

async function chamar(fn, args) {
  const nomes = Object.keys(args);
  const sql = `select public.${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
  await db.exec("set role anon");
  try { return (await db.query(sql, nomes.map((n) => args[n]))).rows[0].r; }
  finally { await db.exec("reset role"); }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (rpc && req.method === "POST") {
    let corpo = "";
    for await (const parte of req) corpo += parte;
    if (!FUNCOES.has(rpc[1])) { res.writeHead(404); return res.end(); }
    try {
      const r = await chamar(rpc[1], corpo ? JSON.parse(corpo) : {});
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(r ?? null));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: e.message }));
    }
  }
  if (url.pathname === "/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(`export const SUPABASE_URL = "http://localhost:${PORTA}";\nexport const SUPABASE_ANON_KEY = "local";\n`);
  }
  const caminho = normalize(join(RAIZ, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!caminho.startsWith(RAIZ) || /node_modules|\.env|supabase|fotos/.test(caminho) || !existsSync(caminho)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TIPOS[extname(caminho)] || "application/octet-stream" });
  res.end(readFileSync(caminho));
}).listen(PORTA, () => console.log(`http://localhost:${PORTA}`));

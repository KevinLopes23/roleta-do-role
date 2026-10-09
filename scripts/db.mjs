// Fala com a Management API do Supabase usando o token do .env.local.
//   node scripts/db.mjs criar               -> cria o projeto (sa-east-1) e salva o ref no .env.local
//   node scripts/db.mjs status              -> mostra se o projeto já está pronto
//   node scripts/db.mjs config              -> escreve config.js (URL + chave anon) e fixa a CSP no projeto
//   node scripts/db.mjs auth                -> desliga o cadastro público do Supabase Auth
//   node scripts/db.mjs sql <arq.sql> ...   -> executa arquivos SQL no banco, em ordem
//   node scripts/db.mjs consulta "<sql>"    -> executa uma consulta e imprime o resultado
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const API = "https://api.supabase.com/v1";
const ENV = new URL("../.env.local", import.meta.url);

function lerEnv() {
  if (!existsSync(ENV)) throw new Error("Crie o arquivo .env.local com SUPABASE_ACCESS_TOKEN=...");
  const linhas = readFileSync(ENV, "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l));
  return Object.fromEntries(linhas.map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
}

async function api(caminho, opcoes = {}) {
  const token = lerEnv().SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN vazio no .env.local");
  const resp = await fetch(API + caminho, {
    ...opcoes,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opcoes.headers || {}) },
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status} em ${caminho}: ${texto.slice(0, 500)}`);
  return texto ? JSON.parse(texto) : null;
}

function ref() {
  const r = lerEnv().SUPABASE_PROJECT_REF;
  if (!r) throw new Error("SUPABASE_PROJECT_REF ausente: rode 'node scripts/db.mjs criar' primeiro");
  return r;
}

const executar = (query) => api(`/projects/${ref()}/database/query`, { method: "POST", body: JSON.stringify({ query }) });

async function criar() {
  const existente = lerEnv().SUPABASE_PROJECT_REF;
  if (existente) return console.log("Projeto já existe:", existente);
  const orgs = await api("/organizations");
  if (!orgs.length) throw new Error("Nenhuma organização na conta do Supabase");
  const projeto = await api("/projects", {
    method: "POST",
    body: JSON.stringify({ name: "roleta-do-role", organization_id: orgs[0].id, region: "sa-east-1", db_pass: randomBytes(18).toString("base64url") }),
  });
  appendFileSync(ENV, `\nSUPABASE_PROJECT_REF=${projeto.id}\n`);
  console.log(`Projeto criado na organização "${orgs[0].name}": ${projeto.id} (leva uns 2 min pra ficar pronto)`);
}

async function status() {
  console.log((await api(`/projects/${ref()}`)).status);
}

async function config() {
  const chaves = await api(`/projects/${ref()}/api-keys`);
  const anon = chaves.find((k) => k.name === "anon")?.api_key;
  if (!anon) throw new Error("Chave anon não encontrada");
  const url = `https://${ref()}.supabase.co`;
  writeFileSync(new URL("../config.js", import.meta.url),
    "// Gerado por scripts/db.mjs. A chave anon é pública por design: o banco só responde via RPC com sessão.\n"
    + `export const SUPABASE_URL = "${url}";\nexport const SUPABASE_ANON_KEY = "${anon}";\n`);
  // A CSP só deixa o site falar com ESTE projeto do Supabase.
  const index = new URL("../index.html", import.meta.url);
  writeFileSync(index, readFileSync(index, "utf8").replace(/https:\/\/[\w*-]+\.supabase\.co/, url));
  console.log("config.js e CSP do index.html atualizados");
}

async function auth() {
  await api(`/projects/${ref()}/config/auth`, { method: "PATCH", body: JSON.stringify({ disable_signup: true }) });
  console.log("Cadastro público do Supabase Auth desligado");
}

async function sql(arquivos) {
  for (const a of arquivos) {
    await executar(readFileSync(a, "utf8"));
    console.log("ok:", a);
  }
}

const [cmd, ...args] = process.argv.slice(2);
const comandos = {
  criar,
  status,
  config,
  auth,
  sql: () => sql(args),
  consulta: async () => console.log(JSON.stringify(await executar(args.join(" ")), null, 2)),
};
if (!comandos[cmd]) {
  console.error('uso: db.mjs criar | status | config | sql <arquivos> | consulta "<sql>"');
  process.exit(1);
}
comandos[cmd]().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});

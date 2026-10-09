// Gera os seeds do banco.
//   node scripts/gerar-seeds.mjs lugares <arquivo.json>   -> SQL de upsert dos lugares (stdout)
//   node scripts/gerar-seeds.mjs privado                  -> supabase/seed-privado.sql (fotos + convite; fora do git)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const RAIZ = new URL("../", import.meta.url);
const CAMPOS = ["id", "nome", "cidade", "distancia_km", "categoria", "preco", "faixa", "descricao", "o_que_fazer", "endereco", "horario", "dica", "link"];
const NUMERICOS = new Set(["preco", "distancia_km"]);

export const sqlTexto = (v) => (v == null || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);

export function validarLugar(l) {
  const erros = [];
  if (!/^[a-z0-9-]{3,80}$/.test(l.id || "")) erros.push("id deve ser slug");
  if (!l.nome) erros.push("nome obrigatório");
  if (!l.cidade) erros.push("cidade obrigatória");
  if (!Number.isInteger(l.preco) || l.preco < 1 || l.preco > 5000) erros.push("preco inteiro 1–5000");
  if (l.distancia_km != null && (!Number.isInteger(l.distancia_km) || l.distancia_km < 0 || l.distancia_km > 100)) erros.push("distancia_km 0–100");
  if (l.link && !/^https:\/\//.test(l.link)) erros.push("link precisa ser https");
  return erros;
}

export function lugaresParaSql(lugares) {
  const linhas = lugares.map((l) => {
    const erros = validarLugar(l);
    if (erros.length) throw new Error(`${l.id || l.nome}: ${erros.join(", ")}`);
    return `(${CAMPOS.map((c) => (NUMERICOS.has(c) ? Number(l[c] ?? 0) : sqlTexto(l[c]))).join(", ")})`;
  });
  const atualiza = CAMPOS.slice(1).map((c) => `${c} = excluded.${c}`).join(", ");
  return `insert into public.lugares (${CAMPOS.join(", ")}) values\n${linhas.join(",\n")}\n`
    + `on conflict (id) do update set ${atualiza}, ativo = true;\n`
    + `update public.config set pool_atualizado_em = now() where id = 1;\n`;
}

function gerarPrivado() {
  const foto = (arq) => "data:image/jpeg;base64," + readFileSync(new URL(`fotos/${arq}`, RAIZ)).toString("base64");
  const arqConvite = new URL("fotos/convite.txt", RAIZ);
  // 96 bits aleatórios: inviável de adivinhar, e vai dentro do link (ninguém precisa digitar).
  const convite = existsSync(arqConvite) ? readFileSync(arqConvite, "utf8").trim() : randomBytes(12).toString("base64url");
  writeFileSync(arqConvite, convite + "\n");
  const sql = `insert into public.jogadores (id, nome, foto) values
  (1, 'Kevin', ${sqlTexto(foto("kevin.jpg"))}),
  (2, 'Ela', ${sqlTexto(foto("ela.jpg"))})
on conflict (id) do update set foto = excluded.foto;
insert into public.config (id, convite_hash) values (1, extensions.crypt(${sqlTexto(convite)}, extensions.gen_salt('bf')))
on conflict (id) do update set convite_hash = excluded.convite_hash;
`;
  writeFileSync(new URL("supabase/seed-privado.sql", RAIZ), sql);
  console.log("supabase/seed-privado.sql gerado. Convite salvo em fotos/convite.txt");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [modo, arquivo] = process.argv.slice(2);
  if (modo === "lugares") process.stdout.write(lugaresParaSql(JSON.parse(readFileSync(arquivo, "utf8"))));
  else if (modo === "privado") gerarPrivado();
  else {
    console.error("uso: gerar-seeds.mjs lugares <arquivo.json> | privado");
    process.exit(1);
  }
}

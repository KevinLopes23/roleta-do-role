# Roleta do Rolê

Site do casal para sortear rolês surpresa em Bauru e região (até 100 km, R$ 20–600).
Cada um na sua vez gira a roleta, raspa o bilhete secreto e leva o outro. Os gastos se equilibram sozinhos.

- **Front:** HTML/CSS/JS puro (`index.html`, `app.js`, `componentes.js`, `util.js`), publicado no GitHub Pages.
- **Banco:** Supabase. Todo acesso passa por funções RPC em `supabase/schema.sql`. As tabelas não são acessíveis pela chave pública.
- **Privado (fora do git):** `.env.local` (token do Supabase), `fotos/` (fotos e código de convite), `supabase/seed-privado.sql`.

## Primeira configuração

```bash
npm install
# .env.local com SUPABASE_ACCESS_TOKEN=<token de supabase.com/dashboard/account/tokens>
node scripts/db.mjs criar          # cria o projeto no Supabase (sa-east-1)
node scripts/db.mjs status         # espere ACTIVE_HEALTHY
node scripts/gerar-seeds.mjs privado
node scripts/db.mjs sql supabase/schema.sql supabase/seed-privado.sql supabase/seed-lugares.sql
node scripts/db.mjs config         # escreve config.js
```

## Atualizar a roleta (antes de cada rodada)

1. Edite `supabase/lugares.json` (mesmo `id` para o mesmo lugar, preço = total do casal).
2. `node scripts/gerar-seeds.mjs lugares supabase/lugares.json > supabase/seed-lugares.sql`
3. `node scripts/db.mjs sql supabase/seed-lugares.sql`

Para tirar um lugar da roleta: `node scripts/db.mjs consulta "update lugares set ativo = false where id = '<id>'"`.

## Desenvolvimento

```bash
npm test                              # testes do banco (PGlite) e utilitários
node scripts/servidor-local.mjs       # http://localhost:5173 com banco simulado
```

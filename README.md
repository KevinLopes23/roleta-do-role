# Roleta do Rolê

Aplicação web para casais sortearem encontros surpresa em Bauru-SP e região. A cada rodada, um dos dois gira a roleta, recebe em segredo um lugar para levar o outro e, depois do encontro, registra quanto gastou. O sistema equilibra os gastos entre os dois ao longo do tempo.

**Produção:** https://kevinlopes23.github.io/roleta-do-role/

---

## Sumário

- [Funcionalidades](#funcionalidades)
- [Regras do jogo](#regras-do-jogo)
- [Arquitetura](#arquitetura)
- [Segurança](#segurança)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Pré-requisitos](#pré-requisitos)
- [Configuração do ambiente](#configuração-do-ambiente)
- [Desenvolvimento local](#desenvolvimento-local)
- [Testes](#testes)
- [Manutenção da roleta](#manutenção-da-roleta)
- [Publicação](#publicação)
- [Referência de scripts](#referência-de-scripts)

---

## Funcionalidades

| Recurso | Descrição |
|---|---|
| Roleta com sorteio ponderado | O lugar é sorteado no servidor, com peso maior para preços próximos do valor-alvo de cada jogador e para lugares em Bauru. |
| Bilhete secreto (raspadinha) | Só quem girou vê o lugar sorteado, revelado ao raspar o bilhete na tela. |
| Recado em envelope | Quem vai levar deixa uma dica (roupa, horário) sem revelar o destino. |
| Gangorra dos gastos | Mostra visualmente quanto cada um já gastou e quem está "devendo". |
| Álbum de polaroids | Histórico dos encontros realizados, com local, data e valor. |
| Trocas limitadas | Até 2 trocas por vez (girar de novo ou cancelar), sem brecha para sortear sem limite. |
| Trava de estoque | Com menos de `minimo_lugares` (padrão: 10) disponíveis, o giro é bloqueado e o site avisa que a roleta precisa ser abastecida. |
| Acesso por PIN | Cada jogador tem um PIN próprio. Os perfis são ativados uma única vez por link de convite. |

## Regras do jogo

- Lugares em Bauru ou a até **100 km**, com custo total do casal entre **R$ 20 e R$ 600**.
- A vez alterna entre os jogadores a cada encontro concluído.
- **Divisão justa:** o valor-alvo do sorteio é `R$ 160 + (gasto do outro − meu gasto)`, limitado entre R$ 20 e R$ 600. Quem gastou menos tende a sortear encontros mais caros, até empatar.
- Um lugar visitado só volta para a roleta após **76 dias** (cerca de 2,5 meses).

## Arquitetura

```
┌───────────────────────────┐       HTTPS (RPC)       ┌─────────────────────────────────┐
│  GitHub Pages             │ ──────────────────────▶ │  Supabase (Postgres, sa-east-1) │
│  HTML + CSS + JS (ESM)    │  chave anon + token de  │  RLS ligado, sem policies       │
│  sem build, sem framework │  sessão no corpo        │  funções SECURITY DEFINER       │
└───────────────────────────┘                         └─────────────────────────────────┘
```

- **Front-end:** HTML, CSS e JavaScript puros (módulos ES), sem etapa de build. Animações em Canvas e SVG, transições com View Transitions API e suporte a `prefers-reduced-motion`.
- **Back-end:** apenas o Postgres do Supabase. Toda a regra de negócio (sessão, sorteio, vez, trocas, saldo e segredo) fica em funções SQL em [`supabase/schema.sql`](supabase/schema.sql), chamadas via PostgREST (`/rest/v1/rpc/*`).
- **Sem servidor próprio e sem custo de API:** a lista de lugares é mantida por pesquisa manual e carregada por script.

### API (RPC)

| Função | Uso |
|---|---|
| `jogadores_publico()` | Lista os perfis (sem fotos) para a tela inicial. |
| `reivindicar(jogador, nome, pin, convite)` | Ativa um perfil uma única vez e devolve um token de sessão. |
| `entrar(jogador, pin)` | Login com PIN; devolve um token de sessão. |
| `painel(token)` | Estado completo da tela do jogador (sem o lugar sorteado pelo outro). |
| `girar` / `regirar` / `cancelar` / `recado` / `concluir` | Ciclo de vida de uma rodada. |
| `sair(token)` | Encerra a sessão. |

## Segurança

- **RLS ligado, sem policies:** a chave pública (`anon`) não lê nem escreve nenhuma tabela diretamente; só executa as funções da API listadas acima.
- **Helpers internos** (`_sortear`, `_sessao` etc.) e o papel `authenticated` não têm permissão de execução. Os *default privileges* do schema `public` foram revogados para que funções novas não nasçam expostas.
- **PIN de 6 a 8 dígitos** armazenado com bcrypt, com bloqueio progressivo após 5 tentativas erradas (15 min, 30 min, 1 h…).
- **Convite de 96 bits**, transmitido no fragmento da URL (`#convite=…`), que não chega ao servidor nem aos logs. Após 5 tentativas erradas, o convite fica bloqueado por 1 hora, e ele é inútil depois que os dois perfis estão ativos.
- **Sessões** com token aleatório de 192 bits, guardado apenas como hash SHA-256 e com validade de 120 dias.
- **Segredo do sorteio:** o lugar só é devolvido ao dono da rodada; o outro jogador recebe apenas a dica e o horário.
- **Front-end:** Content Security Policy restrita ao próprio domínio e ao projeto Supabase, renderização apenas com `textContent` (sem `innerHTML`) e links externos validados como `https`.
- **Dados pessoais fora do repositório:** fotos, código de convite e credenciais ficam em arquivos ignorados pelo git. As fotos ficam no banco e só são entregues após o login.

## Estrutura do projeto

```
.
├── index.html                 # página única (CSP, fontes, ponto de entrada)
├── styles.css                 # tokens visuais e componentes
├── app.js                     # telas, fluxo e chamadas RPC
├── componentes.js             # roleta, raspadinha, gangorra, teclado de PIN, folha, confete
├── util.js                    # funções puras (formatação, validação, mensagens)
├── config.js                  # URL e chave anon do Supabase (gerado por script)
├── assets/icone.svg
├── supabase/
│   ├── schema.sql             # tabelas, regras do jogo e API (idempotente)
│   ├── lugares.json           # fonte da verdade dos lugares da roleta
│   └── seed-lugares.sql       # gerado a partir de lugares.json
└── scripts/
    ├── db.mjs                 # Management API do Supabase (criar, config, sql…)
    ├── gerar-seeds.mjs        # gera os seeds de lugares e o seed privado
    ├── servidor-local.mjs     # servidor de desenvolvimento com banco simulado
    └── *.test.mjs             # testes (node:test + PGlite)
```

Arquivos locais ignorados pelo git: `.env.local`, `fotos/` e `supabase/seed-privado.sql`.

## Pré-requisitos

- Node.js 20 ou superior
- Conta no [Supabase](https://supabase.com) e um *access token* de organização
- Repositório no GitHub com GitHub Pages habilitado (branch `main`, pasta raiz)

## Configuração do ambiente

1. Instale as dependências de desenvolvimento:

   ```bash
   npm install
   ```

2. Crie o arquivo `.env.local` na raiz:

   ```env
   SUPABASE_ACCESS_TOKEN=<token de organização>
   ```

3. Crie o projeto e aguarde até que ele esteja pronto:

   ```bash
   node scripts/db.mjs criar
   node scripts/db.mjs status        # repita até ACTIVE_HEALTHY
   ```

4. Coloque as fotos dos jogadores em `fotos/kevin.jpg` e `fotos/ela.jpg` (quadradas, cerca de 400 px) e gere o seed privado, que também cria o código de convite em `fotos/convite.txt`:

   ```bash
   node scripts/gerar-seeds.mjs privado
   ```

5. Aplique o banco, gere a configuração do site e desligue o cadastro público do Supabase Auth:

   ```bash
   node scripts/db.mjs sql supabase/schema.sql supabase/seed-privado.sql supabase/seed-lugares.sql
   node scripts/db.mjs config
   node scripts/db.mjs auth
   ```

6. Publique (veja [Publicação](#publicação)) e envie o link de convite aos jogadores:

   ```
   https://<usuario>.github.io/roleta-do-role/#convite=<conteúdo de fotos/convite.txt>
   ```

## Desenvolvimento local

```bash
node scripts/servidor-local.mjs
```

Sobe em `http://localhost:5173` com o banco simulado em memória (PGlite), usando o mesmo `schema.sql` e os seeds. Os dados são descartados a cada reinício.

## Testes

```bash
npm test
```

A suíte roda o `schema.sql` num Postgres embutido (PGlite) e cobre:

- ativação de perfil, convite, PIN e bloqueios;
- segredo do sorteio entre os jogadores;
- limite de trocas e cancelamentos;
- equilíbrio de gastos e bloqueio de 76 dias;
- trava por estoque mínimo;
- permissões dos papéis `anon` e `authenticated`;
- geração e validação dos seeds de lugares;
- funções utilitárias do front-end.

## Manutenção da roleta

### Adicionar ou atualizar lugares

1. Edite [`supabase/lugares.json`](supabase/lugares.json). Cada item:

   ```json
   {
     "id": "nome-do-lugar-cidade",
     "nome": "Nome do Lugar",
     "cidade": "Bauru",
     "distancia_km": 0,
     "categoria": "Japonês",
     "preco": 180,
     "faixa": "~R$ 150–210 o casal",
     "descricao": "...",
     "o_que_fazer": "...",
     "endereco": "...",
     "horario": "...",
     "dica": "...",
     "link": "https://..."
   }
   ```

   - `id`: slug estável (`a-z`, `0-9`, `-`). O bloqueio de repetição usa esse campo, então mantenha o mesmo `id` para o mesmo lugar.
   - `preco`: estimativa do total do casal, inteiro entre 20 e 600.
   - `distancia_km`: inteiro de 0 a 100.
   - `link`: só `https`.

2. Gere o seed e aplique (a operação é um *upsert*, então pode ser repetida):

   ```bash
   node scripts/gerar-seeds.mjs lugares supabase/lugares.json > supabase/seed-lugares.sql
   node scripts/db.mjs sql supabase/seed-lugares.sql
   ```

### Outras operações

```bash
# tirar um lugar da roleta
node scripts/db.mjs consulta "update lugares set ativo = false where id = '<id>'"

# ver quantos lugares estão disponíveis
node scripts/db.mjs consulta "select count(*) from _disponiveis()"

# alterar o estoque mínimo que trava a roleta
node scripts/db.mjs consulta "update config set minimo_lugares = 10"
```

## Publicação

O site é servido pelo GitHub Pages direto da branch `main`; um `git push` publica a nova versão em cerca de um minuto.

O GitHub Pages mantém cache de 10 minutos. Ao alterar `app.js`, `componentes.js`, `util.js` ou `styles.css`, incremente o parâmetro de versão (`?v=N`) em `index.html` e nos `import` de `app.js` para que os navegadores baixem os arquivos novos.

Alterações no banco são feitas reaplicando `supabase/schema.sql`, que é idempotente.

## Referência de scripts

| Comando | Descrição |
|---|---|
| `npm test` | Executa toda a suíte de testes. |
| `node scripts/servidor-local.mjs [porta]` | Servidor local com banco simulado. |
| `node scripts/db.mjs criar` | Cria o projeto no Supabase (região `sa-east-1`). |
| `node scripts/db.mjs status` | Mostra o estado do projeto. |
| `node scripts/db.mjs config` | Gera `config.js` e fixa o domínio do Supabase na CSP. |
| `node scripts/db.mjs auth` | Desliga o cadastro público do Supabase Auth. |
| `node scripts/db.mjs sql <arquivos…>` | Executa arquivos SQL no banco, em ordem. |
| `node scripts/db.mjs consulta "<sql>"` | Executa uma consulta e imprime o resultado. |
| `node scripts/gerar-seeds.mjs lugares <arquivo.json>` | Gera o SQL de *upsert* dos lugares. |
| `node scripts/gerar-seeds.mjs privado` | Gera o seed privado (fotos e convite). |

# Spec: Local Project Bootstrap

**Status:** living document
**Owner:** Lunex engineering
**Related docs:** [`PROJECT_SPEC.md`](./PROJECT_SPEC.md), [`../LOCAL_TESTNET_DEPLOY.md`](../LOCAL_TESTNET_DEPLOY.md), [`../../README.md`](../../README.md)

## Objective

Documentar o caminho operacional para subir o Lunex localmente com nó Lunes, contratos ink!, tokens de teste, API, frontend e validação mínima de QA.

Sucesso significa que um ambiente limpo consegue:

- iniciar um nó Lunes local com `pallet_contracts`;
- deployar os contratos principais do DEX;
- criar WLUNES/LUSDT e liquidez inicial;
- validar contratos em chain;
- executar o teste E2E de liquidez e swap;
- iniciar `spot-api` e `lunes-dex-main` apontando para a rede local.

## Tech Stack

| Camada | Ferramenta | Observação |
|---|---|---|
| Node local | `lunes-nightly` | Runtime Lunes com `pallet_contracts`, `pallet_assets`, `ContractsApi` e chain extension de assets |
| Contratos | ink! 4.2.1 / Rust | Artefatos em `target/ink/*` |
| Deploy/QA | TypeScript + `@polkadot/api-contract` | Scripts em `spot-api/scripts/` |
| Backend | Express + TypeScript | `spot-api`, portas `4000` e `4001` |
| Frontend | React + Vite | `lunes-dex-main`, porta local sugerida `3000` |
| Persistência | PostgreSQL + Prisma | Banco `lunex_spot` |
| Cache/nonces | Redis | `redis://127.0.0.1:6379` |
| Docker | Compose opcional | Sobe app services; o nó Lunes continua recomendado no host |

## Commands

### 1. Instalar dependências do projeto

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex
npm install
npm --prefix spot-api install
npm --prefix lunes-dex-main install
```

### 2. Subir PostgreSQL e Redis

```bash
brew services start postgresql@16
brew services start redis

createuser -s postgres 2>/dev/null || true
createdb -U postgres lunex_spot 2>/dev/null || true
```

Se usar Docker apenas para banco/cache, mantenha as URLs do `.env` alinhadas com as portas expostas pelo compose.

### 3. Compilar o nó Lunes local

```bash
cd /Users/lucas/Documents/Projetos_DEV
test -d lunes-nightly || git clone https://github.com/lunes-platform/lunes-nightly.git lunes-nightly
cd lunes-nightly
rustup toolchain install nightly-2023-01-01
rustup target add wasm32-unknown-unknown --toolchain nightly-2023-01-01

PROTOC="$(which protoc)" rustup run nightly-2023-01-01 cargo build --release
```

No macOS, se `protoc` não estiver instalado:

```bash
brew install protobuf
```

Nota de build local: se o build do `lunes-nightly` falhar por incompatibilidade de `wasm-bindgen` com o Rust instalado, atualize somente os pacotes `wasm-bindgen*` do `Cargo.lock` para uma versão compatível e repita o build.

### 4. Iniciar o nó Lunes dev

```bash
cd /Users/lucas/Documents/Projetos_DEV/lunes-nightly
./target/release/lunes-node --dev --tmp --ws-port 9944 --rpc-port 9933 -lruntime::contracts=debug
```

Endpoints:

- WebSocket: `ws://127.0.0.1:9944`
- HTTP RPC: `http://127.0.0.1:9933`
- Explorer: `https://polkadot.js.org/apps/?rpc=ws://127.0.0.1:9944`

O modo `--tmp` apaga estado a cada restart. Sempre redeploye contratos depois de reiniciar o nó.

### 5. Configurar `.env`

Backend:

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex
test -f spot-api/.env || cp spot-api/.env.example spot-api/.env
```

Valores mínimos para `spot-api/.env`:

```dotenv
DATABASE_URL="postgresql://postgres:@localhost:5432/lunex_spot?schema=public"
LUNES_WS_URL="ws://127.0.0.1:9944"
REDIS_URL="redis://127.0.0.1:6379"
ADMIN_SECRET="dev-secret-troque-em-producao"
RELAYER_SEED="//Alice"
PORT=4000
WS_PORT=4001
CORS_ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001"
```

Frontend:

```bash
test -f lunes-dex-main/.env || cp lunes-dex-main/.env.example lunes-dex-main/.env
```

Valores mínimos para `lunes-dex-main/.env`:

```dotenv
REACT_APP_NETWORK=testnet
REACT_APP_RPC_TESTNET=ws://127.0.0.1:9944
REACT_APP_SPOT_API_URL=http://localhost:4000
REACT_APP_WS_URL=ws://localhost:4001
REACT_APP_DEV_MODE=false
```

Os scripts de deploy/setup atualizam os endereços locais em `spot-api/deployed-addresses.json` e podem sincronizar o `.env` do frontend.

Depois de configurar o `.env`, aplique o schema e o seed do banco:

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/spot-api
npx prisma db push
npx prisma generate
npx prisma db seed
```

### 6. Deployar contratos e liquidez local

Com o nó rodando:

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/spot-api
npx ts-node scripts/deploy-contracts.ts
npx ts-node scripts/setup-local-tokens.ts
npx ts-node scripts/check-contracts-qa.ts
npx ts-node scripts/test-liquidity-pool.ts
```

Ordem esperada:

1. `deploy-contracts.ts` publica WLUNES, pair code hash, factory, router, staking e rewards.
2. `setup-local-tokens.ts` cria LUSDT local, par WLUNES/LUSDT e liquidez inicial.
3. `check-contracts-qa.ts` confirma que os endereços têm código on-chain.
4. `test-liquidity-pool.ts` executa deploy temporário, liquidez e swap WLUNES -> LUSDT.

### 7. Rodar backend e frontend

Terminal da API:

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/spot-api
npm run dev
```

Terminal do frontend:

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main
npm run dev -- --host 127.0.0.1 --port 3000
```

URLs locais:

- API: `http://localhost:4000`
- WebSocket da API: `ws://localhost:4001`
- Frontend: `http://127.0.0.1:3000`

### 8. Docker opcional para app services

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex
test -f docker/.env.docker || cp docker/.env.docker.example docker/.env.docker
docker compose -f docker-compose.dev.yml up --build
```

No Docker local, `LUNES_WS_URL` deve apontar para o nó no host:

```dotenv
LUNES_WS_URL=ws://host.docker.internal:9944
```

## Project Structure

| Caminho | Papel |
|---|---|
| `Lunex/contracts/` | Contratos ink! do protocolo |
| `target/ink/` | Artefatos `.contract`, `.wasm` e metadata usados pelos scripts |
| `spot-api/scripts/deploy-contracts.ts` | Deploy dos contratos core |
| `spot-api/scripts/setup-local-tokens.ts` | Criação de tokens e pool local |
| `spot-api/scripts/check-contracts-qa.ts` | QA de presença de código on-chain |
| `spot-api/scripts/test-liquidity-pool.ts` | E2E de liquidez e swap |
| `spot-api/deployed-addresses.json` | Endereços do ambiente local atual |
| `lunes-dex-main/.env` | Configuração do frontend para a rede local |
| `../lunes-nightly/` | Checkout recomendado do nó Lunes local |

## Code Style

Use comandos reproduzíveis, com diretório explícito e flags completas:

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/spot-api
npx ts-node scripts/check-contracts-qa.ts
```

Evite instruções vagas como "rode o deploy" sem nome de script, diretório de execução e pré-condições.

## Testing Strategy

Validação mínima antes de considerar o ambiente local pronto:

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex
cargo test --manifest-path Lunex/contracts/pair/Cargo.toml

cd /Users/lucas/Documents/Projetos_DEV/Lunex/spot-api
npx ts-node scripts/check-contracts-qa.ts
npx ts-node scripts/test-liquidity-pool.ts
npm run build
```

Validação adicional quando alterar frontend:

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main
npm run build
```

## Boundaries

- Always: manter `LUNES_WS_URL`, `REACT_APP_RPC_TESTNET` e scripts apontando para o mesmo nó local.
- Always: redeployar contratos após reiniciar o nó com `--tmp`.
- Always: validar `check-contracts-qa.ts` e `test-liquidity-pool.ts` depois de alterar artefatos ou scripts de deploy.
- Ask first: trocar runtime alvo, mudar chain spec, alterar scripts para mainnet/testnet pública ou persistir seeds.
- Ask first: adicionar dependências globais obrigatórias ou trocar versões de toolchain usadas pelo projeto.
- Never: commitar `.env`, mnemonics, private keys, `node_modules`, `target`, `dist`, `build` ou `.next`.
- Never: usar seed de desenvolvimento em produção.

## Known Failure Modes

| Sintoma | Causa provável | Ação |
|---|---|---|
| `failed to resolve address for github.com` no build | Cargo precisa baixar dependências Git | Repetir com rede liberada |
| `ContractReverted` no swap | O retorno ink! precisa de dry-run para detalhe | Rodar query/dry-run antes do tx e checar enum de erro |
| `priceImpactTooHigh` | Swap grande para pool local pequena | Usar valor menor no E2E ou aumentar liquidez inicial |
| `overflow` no pair | Cálculo TWAP/reserve inválido para `u128` | Validar `contracts/pair/lib.rs` e rodar teste unitário do pair |
| `sign extension operations support is not enabled` | WASM compilado com instruções não aceitas pelo runtime | Recompilar artefato sem sign-ext ou aplicar `wasm-opt --signext-lowering` |
| `unknown export` | WASM exporta símbolos além de `deploy` e `call` | Garantir artefato final com apenas exports esperados |
| `Maximum number of pages should be always declared` | Memória WASM sem limite máximo | Declarar/importar memória com `max` compatível |

## Success Criteria

- `lunes-node` responde em `ws://127.0.0.1:9944`.
- `spot-api/deployed-addresses.json` contém `wnative`, `pairCodeHash`, `factory`, `router`, `staking`, `rewards`, `lusdt` e `pairWlunesLusdt`.
- `npx ts-node scripts/check-contracts-qa.ts` retorna sucesso para todos os endereços de contrato.
- `npx ts-node scripts/test-liquidity-pool.ts` confirma aumento de saldo LUSDT após swap.
- `spot-api` inicia em `http://localhost:4000`.
- `lunes-dex-main` inicia em `http://127.0.0.1:3000` usando a RPC local.

## Open Questions

- Automatizar a reconstrução especial do artefato `pair_contract` em um script versionado.
- Decidir se `lunes-nightly` deve virar submódulo, dependência documentada externa ou imagem Docker interna.
- Definir se o compose local deve incluir o nó Lunes ou continuar consumindo o nó no host.

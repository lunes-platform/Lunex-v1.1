# Lunex DEX — Deploy na Testnet Local (Guia Completo)

Este documento descreve tudo que foi necessário para realizar um deploy bem-sucedido dos contratos ink! na testnet local da Lunes e conectar o frontend.

> **Status atual:** este guia mantém notas históricas e troubleshooting detalhado. O caminho canônico para subir o projeto localmente está em [`docs/specs/LOCAL_PROJECT_BOOTSTRAP_SPEC.md`](./specs/LOCAL_PROJECT_BOOTSTRAP_SPEC.md) e o resumo operacional está no [`README.md`](../README.md#5-setup-local--passo-a-passo).

---

## Caminho Validado Atual

Use este fluxo para subir a stack local com runtime Lunes real, contratos, tokens de teste e QA mínimo.

### 1. Nó Lunes local

```bash
cd /Users/lucas/Documents/Projetos_DEV
test -d lunes-nightly || git clone https://github.com/lunes-platform/lunes-nightly.git lunes-nightly
cd lunes-nightly
rustup toolchain install nightly-2023-01-01
rustup target add wasm32-unknown-unknown --toolchain nightly-2023-01-01

# Se protoc não existir: brew install protobuf
PROTOC="$(which protoc)" rustup run nightly-2023-01-01 cargo build --release

./target/release/lunes-node --dev --tmp --ws-port 9944 --rpc-port 9933 -lruntime::contracts=debug
```

Endpoints:

- WS: `ws://127.0.0.1:9944`
- RPC HTTP: `http://127.0.0.1:9933`
- Explorer: `https://polkadot.js.org/apps/?rpc=ws://127.0.0.1:9944`

O runtime validado contém `pallet_contracts`, `pallet_assets`, `ContractsApi` e chain extension de assets.

### 2. Banco, cache e `.env`

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex
npm install
npm --prefix spot-api install
npm --prefix lunes-dex-main install
test -f spot-api/.env || cp spot-api/.env.example spot-api/.env
test -f lunes-dex-main/.env || cp lunes-dex-main/.env.example lunes-dex-main/.env

brew services start postgresql@16
brew services start redis
createuser -s postgres 2>/dev/null || true
createdb -U postgres lunex_spot 2>/dev/null || true
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
```

Valores mínimos para `lunes-dex-main/.env`:

```dotenv
REACT_APP_NETWORK=testnet
REACT_APP_RPC_TESTNET=ws://127.0.0.1:9944
REACT_APP_SPOT_API_URL=http://localhost:4000
REACT_APP_WS_URL=ws://localhost:4001
REACT_APP_DEV_MODE=false
```

### 3. Schema, deploy e QA

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/spot-api
npx prisma db push
npx prisma generate
npx prisma db seed

npx ts-node scripts/deploy-contracts.ts
npx ts-node scripts/setup-local-tokens.ts
npx ts-node scripts/check-contracts-qa.ts
npx ts-node scripts/test-liquidity-pool.ts
```

O deploy atualiza `spot-api/deployed-addresses.json`. Como o nó roda com `--tmp`, esses endereços são válidos apenas enquanto o processo do nó atual permanecer vivo.

### 4. API e frontend

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/spot-api
npm run dev
```

```bash
cd /Users/lucas/Documents/Projetos_DEV/Lunex/lunes-dex-main
npm run dev -- --host 127.0.0.1 --port 3000
```

---

## Notas Históricas e Troubleshooting

As seções abaixo registram problemas e correções encontrados durante a primeira integração ink!/Lunes. Use-as para diagnóstico, mas prefira o fluxo acima para uma subida nova.

---

## Pré-requisitos

### 1. Rust + Toolchain

```bash
# Instalar rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Usar Rust 1.82.0 (necessário para ink! 4.x + cargo-contract 5.x)
rustup install 1.82.0
rustup default 1.82.0
rustup target add wasm32-unknown-unknown

# Verificar
rustc --version  # deve mostrar 1.82.0
```

### 2. cargo-contract

```bash
# Instalar versão compatível (5.x para ink! 4.2.1)
cargo install cargo-contract --version "^5" --locked

# Se der erro de compilação com substrate-build-script-utils:
# usar o flag --features build-core-std=false ou fazer downgrade do cargo-contract
```

### 3. Node.js e pnpm/npm

```bash
node --version  # >= 18.x recomendado
npm --version
```

### 4. Lunes Node (nó local)

O nó local precisa ter `pallet-contracts` habilitado no Runtime. O nó oficial da Lunes (Nightly) tem esse suporte.

```bash
# Iniciar o nó local (substitua pelo binário correto da Lunes)
./lunes-node --dev --tmp
# ou
./lunes-node --chain=local --ws-port=9944 --rpc-port=9933
```

O nó deve estar acessível em `ws://127.0.0.1:9944`.

---

## Passo 1: Compilar os Contratos

```bash
cd Lunex/contracts

# Compilar cada contrato com cargo-contract
for contract in wnative pair factory router staking rewards; do
  echo "Building $contract..."
  (cd $contract && cargo +1.82.0 contract build --release)
done

# Os artefatos ficam em:
# target/ink/wnative_contract/wnative_contract.contract
# target/ink/pair_contract/pair_contract.contract
# target/ink/factory_contract/factory_contract.contract
# target/ink/router_contract/router_contract.contract
# target/ink/staking_contract/staking_contract.contract
# target/ink/trading_rewards_contract/trading_rewards_contract.contract
```

### Problemas Comuns no Build

**Erro: `pair` e `router` não geram `.contract` file**
Causa: PSP22 selectors e cross-contract calls requerem flags específicos.
Solução: Garantir que os `Cargo.toml` têm as dependências corretas (ver correções abaixo).

---

## Passo 2: Correções Críticas Aplicadas

### 2.1 Factory — `create_pair` não deployava o par

**Problema:** A função `create_pair` calculava um endereço via hash mas nunca fazia deploy do contrato par.

**Correção em `factory/Cargo.toml`:**
```toml
pair_contract = { path = "../pair", default-features = false, features = ["ink-as-dependency"] }

[features]
std = [
    "ink/std",
    "scale/std",
    "scale-info/std",
    "pair_contract/std",
]
```

**Correção em `factory/lib.rs`:**
```rust
use pair_contract::pair_contract::PairContractRef;

// Em create_pair():
let mut salt = Vec::new();
salt.extend_from_slice(token_0.as_ref());
salt.extend_from_slice(token_1.as_ref());

let code_hash = self.pair_contract_code_hash.get().unwrap_or_default();
let factory_address = self.env().account_id();

let pair = PairContractRef::new(factory_address, token_0, token_1)
    .code_hash(code_hash)
    .gas_limit(0)
    .endowment(0)
    .salt_bytes(&salt)
    .instantiate();

let pair_address: AccountId = *pair.as_ref();

// Usar free function para emit_event (evita ambiguidade de trait):
ink::env::emit_event::<ink::env::DefaultEnvironment, PairCreated>(PairCreated {
    token_0, token_1, pair: pair_address, length: self.all_pairs.len() as u64,
});
```

> **Nota:** Ao importar `pair_contract` como `ink-as-dependency`, o trait `EmitEvent` fica ambíguo. A solução é usar `ink::env::emit_event::<DefaultEnvironment, EventType>(event)` com dois type params explícitos.

### 2.2 PSP22 Selectors — Router usa namespace PSP22::*

**Problema:** O router e o pair chamam `PSP22::transfer_from` com selector `0x54b3c76e` (namespace OpenBrush), mas os contratos `wnative` e o LP token do `pair` implementavam `transfer_from` sem o selector correto (`0x0b396f18`). O router também passa 4 args (`from, to, amount, data: Vec<u8>`) mas o wnative só aceitava 3.

**Correção em `wnative/lib.rs` e `pair/lib.rs`:**
```rust
use ink::prelude::vec::Vec;

#[ink(message, selector = 0x6568382f)]  // PSP22::balance_of
pub fn balance_of(&self, owner: AccountId) -> Balance { ... }

#[ink(message, selector = 0x4d47d921)]  // PSP22::allowance
pub fn allowance(&self, owner: AccountId, spender: AccountId) -> Balance { ... }

#[ink(message, selector = 0xdb20f9f5)]  // PSP22::transfer
pub fn transfer(&mut self, to: AccountId, value: Balance, _data: Vec<u8>) -> Result<(), Error> { ... }

#[ink(message, selector = 0x54b3c76e)]  // PSP22::transfer_from
pub fn transfer_from(&mut self, from: AccountId, to: AccountId, value: Balance, _data: Vec<u8>) -> Result<(), Error> { ... }

#[ink(message, selector = 0xb20f1bbd)]  // PSP22::approve
pub fn approve(&mut self, spender: AccountId, value: Balance) -> Result<(), Error> { ... }
```

**Tabela de selectors PSP22 (compatível com OpenBrush/router):**
| Método | Selector |
|--------|----------|
| `balance_of` | `0x6568382f` |
| `allowance` | `0x4d47d921` |
| `transfer` | `0xdb20f9f5` |
| `transfer_from` | `0x54b3c76e` |
| `approve` | `0xb20f1bbd` |
| `total_supply` | `0xdb6375a8` |

### 2.3 Deadline em Milliseconds

**Problema:** O router verifica o deadline contra o timestamp da chain Lunes, que usa **milliseconds** (ex: `1772930280000`). Enviar o deadline em segundos (~1772930280) faz parecer que já expirou.

**Correção:**
```typescript
// ❌ Errado — envia segundos
const deadline = Math.floor(Date.now() / 1000) + 3600

// ✅ Correto — envia milliseconds
const deadline = BigInt(Date.now() + 3_600_000)
```

No `contractService.ts` o tratamento é:
```typescript
const deadlineMs = deadline > 1e12 ? deadline : deadline * 1000
```

---

## Passo 3: Deploy dos Contratos

```bash
cd spot-api
npm install

# Rodar script de deploy (requer nó local rodando em ws://127.0.0.1:9944)
npx ts-node scripts/deploy-contracts.ts
```

O script faz na ordem:
1. Deploy do `wnative_contract` (WLUNES, 8 decimais)
2. Upload do código do `pair_contract` (apenas hash, não instância)
3. Deploy do `factory_contract` (passa endereço do deployer e hash do pair)
4. Deploy do `router_contract` (passa factory + wnative)
5. Deploy do `staking_contract`
6. Deploy do `trading_rewards_contract`
7. Salva endereços em `spot-api/deployed-addresses.json`
8. Atualiza `lunes-dex-main/.env`

**Exemplo histórico de endereços deployados (sessão de março 2026):**
```
wnative:  5HRAv1VDeWkLnmkZAjgo6oigU5179nUDBgjKX4u5wztM7tTo
factory:  5D7pe8YhnMpdBHnVobrPooomnM1ikgRJ4vDRyfcppFonCuK2
router:   5GSR7WUo53S2UpqSW7sMccSYNeP2dmAakfUnoK9BCY3YMb2B
staking:  5DuuYUtUhgCsqfBFpGgxiqncU5JrsvDJDxQDmbSx8KWAXyqK
rewards:  5EiX7yUapZmL8LRSb2kbpmohig1rYqyG973ENR9mgdV7Ry6r
pairCodeHash: 0xe03a74087741619e92f516c782a97abd574d75735933b98e74d4052fa924392f
```

> **Atenção:** não use esses endereços como estado atual. Consulte `spot-api/deployed-addresses.json` depois do deploy local. O nó de desenvolvimento reseta ao reiniciar; redeploye sempre que o nó for reiniciado.

---

## Passo 4: Setup de Tokens Locais

Após o deploy dos contratos, é necessário criar tokens de teste e pools de liquidez:

```bash
npx ts-node scripts/setup-local-tokens.ts
```

O script:
1. Deploya token mock LUSDT (6 decimais, via wnative_contract)
2. Faz wrap de 50 LUNES → WLUNES (Alice)
3. Faz wrap de 100.000 LUNES → LUSDT (Alice, simulando mint)
4. Cria o par WLUNES/LUSDT via factory
5. Aprova o router para gastar WLUNES e LUSDT
6. Adiciona liquidez inicial: 20 WLUNES + 50.000 LUSDT (preço: 2.500 LUSDT/WLUNES)
7. Atualiza `.env` com endereços dos tokens e do par

---

## Passo 5: Integração Frontend

### Configuração da Rede

O `contractService.ts` lê o RPC URL do `.env`:
```typescript
testnet: process.env.REACT_APP_RPC_TESTNET || 'wss://ws-test.lunes.io',
```

Para o nó local, o `.env` deve ter:
```env
REACT_APP_NETWORK=testnet
REACT_APP_RPC_TESTNET=ws://127.0.0.1:9944
```

### Nomes de Métodos (ink! 4.x + @polkadot/api-contract)

O `@polkadot/api-contract` converte automaticamente `snake_case` → `camelCase`:
```typescript
// ❌ Errado
contract.query['factory::getPair'](...)
contract.query['psp22::balanceOf'](...)

// ✅ Correto
contract.query['getPair'](...)
contract.query['balanceOf'](...)
```

**Não usar prefixos de namespace** — o ABI usa só o nome da função.

### ABIs do Frontend

Manter os ABIs do frontend sincronizados com os compilados:
```bash
cp target/ink/factory_contract/factory_contract.json lunes-dex-main/src/abis/Factory.json
cp target/ink/pair_contract/pair_contract.json       lunes-dex-main/src/abis/Pair.json
cp target/ink/router_contract/router_contract.json   lunes-dex-main/src/abis/Router.json
cp target/ink/wnative_contract/wnative_contract.json lunes-dex-main/src/abis/WNative.json
```

---

## Passo 6: Rodar o Frontend

```bash
cd lunes-dex-main
npm install
npm start
# Acessa em http://localhost:3000
```

Para testar o swap, use a extensão Polkadot.js com a conta `//Alice` importada.

---

## Teste E2E — Liquidity Pool

O script de teste completo está em `spot-api/scripts/test-liquidity-pool.ts`:

```bash
npx ts-node scripts/test-liquidity-pool.ts
```

Valida 8 etapas:
1. Deploy mock USDT
2. Wrap LUNES → WLUNES
3. Wrap LUNES → mock USDT
4. Criar par WLUNES/USDT via factory
5. Aprovar router
6. Adicionar liquidez (5 WLUNES + 2.500 USDT)
7. Verificar reservas do par
8. Swap WLUNES → USDT

---

## Resolução de Problemas Comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| `isErr: true` na query | Método não encontrado no contrato | Verificar nome camelCase no ABI |
| `expired` no addLiquidity | Deadline em segundos | Usar milliseconds: `Date.now() + 3_600_000` |
| `pairNotExists` no swap | Factory não deployou o par | Verificar create_pair usa PairContractRef, não hash |
| `insufficientAAmount` | PSP22 selector errado | Adicionar `#[ink(message, selector = 0x54b3c76e)]` |
| `ContractReverted` genérico | Vários | Fazer dry-run com `contract.query[method]` antes do tx |
| ABIs desatualizados | Frontend com ABI antigo | Copiar de `target/ink/` para `lunes-dex-main/src/abis/` |

---

## Referências

- Contratos: `Lunex/contracts/`
- Deploy script: `spot-api/scripts/deploy-contracts.ts`
- Token setup: `spot-api/scripts/setup-local-tokens.ts`
- E2E test: `spot-api/scripts/test-liquidity-pool.ts`
- Frontend: `lunes-dex-main/`
- Endereços deployados: `spot-api/deployed-addresses.json`

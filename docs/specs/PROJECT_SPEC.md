# Lunex — Project Spec

**Status:** living document  
**Escopo:** especificação técnica guarda-chuva do projeto  
**Leitura complementar:** [`../prd/PROJECT_PRD.md`](../prd/PROJECT_PRD.md), [`../ARCHITECTURE.md`](../ARCHITECTURE.md)

## Objetivo

Esta SPEC descreve a arquitetura canônica do projeto Lunex em nível de sistema. Ela define limites entre módulos, contratos principais, dependências técnicas e invariantes que specs por feature devem respeitar.

## Módulos Principais

| Módulo | Caminho | Responsabilidade |
|---|---|---|
| Frontend principal | `lunes-dex-main/` | Experiência do usuário para trading, liquidez, social e automação |
| Backend API | `spot-api/` | REST, WebSocket, autenticação, serviços de domínio e integrações on-chain |
| Smart contracts | `Lunex/contracts/` | Liquidez, settlement, staking, listing, wrappers e contratos auxiliares |
| SDK | `sdk/` | Cliente TypeScript para integrações externas |
| Admin | `lunex-admin/` | Operação administrativa e workflows internos |
| Indexação | `subquery-node/` | Processamento de eventos e consulta indexada |
| Integrações MCP | `mcp/` | Ponte para agentes e automações externas |

## Contexto de Arquitetura

O sistema é híbrido:

- **On-chain:** contratos ink!, token logic, settlement e eventos da rede.
- **Off-chain:** matching, APIs, autenticação, indexação, cache, relatórios e automação operacional.
- **Client-side:** interfaces web, SDK, admin e consumidores externos.

## Contratos Entre Camadas

### Frontend e API

- REST para operações síncronas e consultas.
- WebSocket para book, trades, notificações e updates em tempo real.
- Validação de input no backend antes de tocar domínio, banco ou chain.

### API e blockchain

- Integração por Polkadot.js e contratos ink!.
- Operações sensíveis exigem assinatura, relayer controlado ou credenciais administrativas.
- Alterações em contratos ou payloads on-chain devem refletir nas specs de API/SDK.

### API e persistência

- PostgreSQL é a fonte de verdade off-chain.
- Redis cobre nonce, rate limit, cache operacional e estado efêmero.
- Indexadores e reconciliadores devem tratar divergência entre banco e chain explicitamente.

### SDK e APIs públicas

- O SDK deve refletir contratos estáveis do backend.
- Mudanças breaking exigem atualização de SPEC, docs públicas e plano de rollout.

## Invariantes Técnicos

1. O backend valida autenticação, autorização e integridade do payload antes de executar lógica crítica.
2. Mudanças de domínio relevantes precisam especificar impacto em frontend, backend, contratos, banco e SDK.
3. Interfaces públicas não devem nascer apenas no código; precisam de SPEC ou atualização explícita da SPEC principal.
4. Features que alteram fluxo financeiro, assinatura, custody, settlement ou listing exigem plano de teste e análise de falha.
5. Documentação de arquitetura deve apontar para os módulos reais do repositório, não para abstrações genéricas.

## Segurança e Autorização

Os fluxos atuais usam uma combinação de:

- assinatura de wallet para operações do usuário;
- assinatura de wallet também para leituras user-scoped que expõem portfolio, histórico, posição ou preferências privadas;
- bearer token para rotas administrativas;
- API keys e escopos para agentes e automação;
- proteções auxiliares como nonce replay prevention, rate limiting e middleware dedicado.

Specs novas devem declarar claramente:

- quem pode executar a ação;
- como a identidade é validada;
- se a leitura é pública, signed read ou admin-only;
- qual abuso precisa ser mitigado;
- qual é o comportamento em falhas parciais.

## Requisitos Não Funcionais

- **Rastreabilidade:** toda feature relevante deve ligar PRD, SPEC, código, testes e rollout.
- **Compatibilidade:** rotas, payloads e contratos devem evoluir com versionamento claro.
- **Operabilidade:** mudanças precisam declarar migração, seed, env vars, cron jobs ou workers quando houver.
- **Observabilidade:** fluxos críticos precisam de logs estruturados e pontos de verificação operacionais.
- **Testabilidade:** cada módulo alterado precisa declarar a estratégia mínima de validação.

## Specs de Referência

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- [`../SPOT_ORDERBOOK_ARCHITECTURE.md`](../SPOT_ORDERBOOK_ARCHITECTURE.md)
- [`../API_SPECIFICATION.md`](../API_SPECIFICATION.md)
- [`../PUBLIC_API_SPECIFICATION.md`](../PUBLIC_API_SPECIFICATION.md)
- [`../api/openapi.json`](../api/openapi.json)

## Como esta SPEC se relaciona ao SDD

- O PRD principal define o porquê e o valor de negócio.
- Esta SPEC principal define o como em nível de sistema.
- Cada nova feature deve criar sua própria `PRD.md`, `SPEC.md` e `TASKS.md` em `docs/features/<slug>/`.
- Se a feature mudar a visão do produto ou a arquitetura transversal, atualize também este documento ou o PRD principal.

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

### Fronteiras de responsabilidade

Cada mudança deve declarar a camada que possui a regra e a camada que apenas consome o contrato.

| Camada | Pode conter | Não pode conter |
|---|---|---|
| `lunes-dex-main/` | UI, estado visual, composição de páginas, chamadas à API/SDK, preparação de assinatura do usuário, validação leve de formulário | Fonte de verdade para regra financeira, autorização, matching, settlement, rewards, comissões, risco, liquidação ou pricing crítico |
| `spot-api/` | Validação de payload, autorização, regras off-chain, matching, settlement orchestration, persistência, rate limit, métricas e integração com chain/indexadores | UI, decisão visual, cópia divergente de regra on-chain |
| `Lunex/contracts/` | Invariantes on-chain, custody, liquidez, settlement final, permissões verificáveis pela rede | Estado efêmero de UI, lógica operacional que depende de banco off-chain |
| `sdk/` | Tipos públicos, clientes HTTP/WebSocket, helpers de assinatura e adaptação de contratos publicados | Nova regra de negócio divergente da API ou dos contratos |
| `mcp/` | Ferramentas de agente sobre contratos públicos do `spot-api`, assinatura externa, chaves e escopos | Bypass de autorização, assinatura custodial não especificada, regra financeira própria |
| `lunex-admin/` | Operação interna, revisão, ativação, auditoria e dashboards administrativos | Duplicação silenciosa de schema ou regra crítica sem tarefa de sincronização com `spot-api` |

Regra central: o frontend pode calcular valores para exibição e feedback imediato, mas a decisão autoritativa deve ser repetida ou validada no backend e/ou nos contratos.

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
- `spot-api/prisma/schema.prisma` é a fonte principal do schema operacional da API. Se `lunex-admin/prisma/schema.prisma` precisar duplicar modelos, a feature deve incluir uma tarefa explícita de sincronização, diff e validação.

### SDK e APIs públicas

- O SDK deve refletir contratos estáveis do backend.
- Mudanças breaking exigem atualização de SPEC, docs públicas e plano de rollout.

### Admin como fronteira operacional

- `lunex-admin/` é um subprojeto separado e pode ter ciclo de versionamento próprio.
- Mudanças no admin que dependem do banco compartilhado devem apontar para a SPEC da feature correspondente.
- Nenhuma migration ou alteração de schema deve ser feita apenas no admin sem coordenação com `spot-api/prisma/schema.prisma`.

## Invariantes Técnicos

1. O backend valida autenticação, autorização e integridade do payload antes de executar lógica crítica.
2. Mudanças de domínio relevantes precisam especificar impacto em frontend, backend, contratos, banco e SDK.
3. Interfaces públicas não devem nascer apenas no código; precisam de SPEC ou atualização explícita da SPEC principal.
4. Features que alteram fluxo financeiro, assinatura, custody, settlement ou listing exigem plano de teste e análise de falha.
5. Documentação de arquitetura deve apontar para os módulos reais do repositório, não para abstrações genéricas.
6. O frontend não é fonte de verdade para regras de negócio críticas. Qualquer cálculo sensível feito na UI deve ser validado por backend e/ou contrato.
7. Tarefas devem preservar isolamento por pasta e comportamento. Refactors transversais precisam de SPEC, plano e tarefas próprias.

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
- [`./LOCAL_PROJECT_BOOTSTRAP_SPEC.md`](./LOCAL_PROJECT_BOOTSTRAP_SPEC.md)

## Como esta SPEC se relaciona ao SDD

- O PRD principal define o porquê e o valor de negócio.
- Esta SPEC principal define o como em nível de sistema.
- Cada nova feature deve criar sua própria `PRD.md`, `SPEC.md` e `TASKS.md` em `docs/features/<slug>/`.
- Se a feature mudar a visão do produto ou a arquitetura transversal, atualize também este documento ou o PRD principal.

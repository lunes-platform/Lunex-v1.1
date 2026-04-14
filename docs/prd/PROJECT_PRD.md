# Lunex — Project PRD

**Status:** living document  
**Escopo:** visão de produto do projeto inteiro  
**Leitura complementar:** [`../specs/PROJECT_SPEC.md`](../specs/PROJECT_SPEC.md), [`../ARCHITECTURE.md`](../ARCHITECTURE.md)

## Resumo

Lunex é uma plataforma DEX full-stack construída sobre a rede Lunes. O produto combina spot trading, automação por agentes, liquidez programável, token listing, staking, governança e uma camada de serviços para integração por API.

Este PRD organiza a visão do projeto em termos de problema, público-alvo, objetivos e pilares funcionais. Specs detalhadas por feature devem derivar deste documento.

## Problema

O mercado-alvo do Lunex sofre com uma combinação de fricções:

- liquidez fragmentada entre protocolos e experiências desconectadas;
- pouca programabilidade para traders avançados e agentes automatizados;
- excesso de dependência de múltiplas ferramentas para listar ativos, prover liquidez, operar e acompanhar posições;
- baixa clareza entre regras de produto, arquitetura e iniciativas experimentais.

## Visão de Produto

Construir a camada principal de trading e liquidez do ecossistema Lunes, com experiência utilizável por humanos e automação segura para bots e agentes.

## Personas Principais

- **Trader spot:** quer executar ordens com baixa fricção, visibilidade de book, histórico e segurança.
- **LP / power user:** quer prover liquidez, otimizar retorno e acessar estratégias mais avançadas.
- **Projeto emissor / token owner:** quer listar um ativo com regras claras, integração técnica e governança.
- **Builder de bot / agente:** quer operar por API, SDK ou chaves restritas com previsibilidade.
- **Operação / admin:** quer ativar listagens, monitorar risco, validar estado on-chain e manter consistência operacional.

## Pilares do Produto

### 1. Trading e execução

- Spot trading com orderbook, histórico e settlement confiável.
- Roteamento entre diferentes fontes de liquidez quando aplicável.
- APIs e WebSocket para operação programática.

### 2. Liquidez programável

- Pools AMM e mecanismos de liquidez mais avançados.
- Suporte a liquidez assimétrica e estratégias parametrizáveis.
- Capacidade de rebalanceamento e automação com guardrails.

### 3. Ciclo de vida de ativos

- Suporte a tokens PSP22, wLUNES e evolução para assets nativos.
- Processo de listing com critérios de ativação, lock e governança.
- Metadados, token registry e padronização para frontend, API e SDK.

### 4. Retenção e incentivos

- Staking, rewards, social e afiliados como loops de retenção.
- Incentivos alinhados com volume, liquidez e participação no protocolo.

### 5. Integração e automação

- SDK e API pública para DApps, integrações e bots.
- Chaves de API e escopos para agentes de IA.
- Arquitetura preparada para sandboxes, relayers e workflows assistidos.

## Objetivos

- Entregar uma DEX não custodial utilizável ponta a ponta no ecossistema Lunes.
- Manter uma única plataforma para trading, liquidez, listing e automação.
- Reduzir ambiguidade entre discovery, arquitetura e implementação.
- Tornar o desenvolvimento orientado a PRD + SPEC antes do código em iniciativas relevantes.

## Não Objetivos

- Este documento não substitui specs detalhadas por módulo.
- Este documento não tenta congelar todas as ideias experimentais já registradas no repositório.
- Este documento não define backlog granular ou milestones de sprint.

## Escopo Funcional Atual

- Frontend principal em `lunes-dex-main/`.
- Backend de serviços em `spot-api/`.
- Smart contracts em `Lunex/contracts/`.
- SDK TypeScript em `sdk/`.
- Painel admin em `lunex-admin/`.
- Indexação e integrações auxiliares em `subquery-node/`, `mcp/` e scripts operacionais.

## Métricas de Sucesso

- Tempo para colocar uma nova feature em produção com rastreabilidade entre PRD, SPEC e código.
- Cobertura dos principais fluxos de trading, listing e automação por testes e docs.
- Redução de ambiguidade entre documentos duplicados ou conflitantes.
- Capacidade de integrar novos módulos sem quebrar contratos entre frontend, API, SDK e contratos.

## Restrições e Dependências

- A base on-chain depende da rede Lunes, runtime Substrate e contratos ink!.
- Módulos off-chain dependem de PostgreSQL, Redis, WebSocket e Polkadot.js.
- O produto é brownfield: parte da documentação atual descreve visão, parte descreve futuro e parte descreve implementação já existente.

## Documentos-Fonte

- [`../dex-requisitos.md`](../dex-requisitos.md)
- [`../requisitonovo.md`](../requisitonovo.md)
- [`../LUNEX_DEX_FEATURES.md`](../LUNEX_DEX_FEATURES.md)
- [`../PRD_LUNES_NATIVE_ASSETS.md`](../PRD_LUNES_NATIVE_ASSETS.md)
- [`../WLUNES_REQUIREMENTS.md`](../WLUNES_REQUIREMENTS.md)

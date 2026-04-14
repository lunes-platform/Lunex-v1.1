# Lunex Docs Map

Este diretório agora tem uma camada canônica para produto, especificação e processo. Os documentos antigos continuam válidos como material de referência, mas novas iniciativas devem partir dos arquivos abaixo.

## Comece por aqui

| Tipo | Documento | Objetivo |
|---|---|---|
| PRD principal | [`docs/prd/PROJECT_PRD.md`](./prd/PROJECT_PRD.md) | Define visão, escopo de produto, personas e prioridades do projeto |
| Spec principal | [`docs/specs/PROJECT_SPEC.md`](./specs/PROJECT_SPEC.md) | Define a arquitetura guarda-chuva, limites do sistema e contratos entre módulos |
| Processo | [`docs/sdd/README.md`](./sdd/README.md) | Define como aplicar SDD no desenvolvimento do projeto |
| Novas features | [`docs/features/README.md`](./features/README.md) | Define onde cada feature nova deve viver e como nomear os artefatos |
| Exemplo real | [`docs/features/asymmetric-liquidity-v1/`](./features/asymmetric-liquidity-v1/) | Primeiro pacote SDD aplicado a uma feature já existente no código |
| Exemplo AI-first | [`docs/features/agent-smart-router-mcp-v1/`](./features/agent-smart-router-mcp-v1/) | Pacote SDD para expor Smart Router ao MCP de agentes |
| Exemplo transversal | [`docs/features/exchange-auth-contract-alignment-v1/`](./features/exchange-auth-contract-alignment-v1/) | Pacote SDD para alinhar contratos de auth/read da exchange com testes e validação |
| Exemplo social | [`docs/features/social-copytrade-v1/`](./features/social-copytrade-v1/) | Pacote SDD para canonicalizar social graph, copytrade vault e distribuição econômica |

## Estrutura Canônica

| Pasta | Papel |
|---|---|
| `docs/prd/` | Documentos de produto canônicos |
| `docs/specs/` | Especificações técnicas canônicas |
| `docs/sdd/` | Workflow SDD, templates e regras do processo |
| `docs/features/` | PRDs, specs e tasks por feature |
| `docs/guides/` | Guias operacionais, setup e uso |
| `docs/reports/` | Auditorias, QA, análises e relatórios históricos |
| `docs/api/` | Artefatos gerados e contratos de API |

## Fontes de Referência Atuais

### Produto e requisitos

- [`docs/dex-requisitos.md`](./dex-requisitos.md): base conceitual do protocolo e da proposta de valor.
- [`docs/requisitonovo.md`](./requisitonovo.md): discovery expandido com novas iniciativas e ideias de arquitetura.
- [`docs/LUNEX_DEX_FEATURES.md`](./LUNEX_DEX_FEATURES.md): visão funcional ampla dos módulos do protocolo.
- [`docs/PRD_LUNES_NATIVE_ASSETS.md`](./PRD_LUNES_NATIVE_ASSETS.md): PRD específico de native assets.
- [`docs/WLUNES_REQUIREMENTS.md`](./WLUNES_REQUIREMENTS.md): requisitos específicos do wrapper de LUNES.

### Arquitetura e specs técnicas

- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md): visão geral da arquitetura atual do sistema.
- [`docs/SPOT_ORDERBOOK_ARCHITECTURE.md`](./SPOT_ORDERBOOK_ARCHITECTURE.md): spec profunda do orderbook spot.
- [`docs/API_SPECIFICATION.md`](./API_SPECIFICATION.md): spec da API geral.
- [`docs/PUBLIC_API_SPECIFICATION.md`](./PUBLIC_API_SPECIFICATION.md): spec da API pública e de automação.
- [`docs/api/openapi.json`](./api/openapi.json): contrato OpenAPI.

## Regras de Uso

1. Mudanças de produto de médio/grande porte começam em `docs/features/<feature-slug>/`.
2. Quando uma mudança alterar visão de produto ou arquitetura transversal, atualize também o PRD ou a SPEC principal.
3. Documentos antigos não precisam ser apagados imediatamente; trate-os como referência até que sejam absorvidos pela estrutura canônica.
4. Relatórios de execução, QA, segurança e auditoria continuam indo para `docs/reports/`.

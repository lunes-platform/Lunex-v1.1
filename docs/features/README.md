# Feature Docs

Toda iniciativa nova de produto deve nascer aqui.

## Convenção

- Pasta: `docs/features/<feature-slug>/`
- Arquivos mínimos: `PRD.md`, `SPEC.md`, `TASKS.md`
- Slug: curto, estável e descritivo. Exemplo: `spot-orderbook-v2`, `token-listing-governance`, `asymmetric-liquidity`

## Exemplo

```text
docs/features/spot-orderbook-v2/
  PRD.md
  SPEC.md
  TASKS.md
```

Exemplo real já criado no projeto:

- [`docs/features/asymmetric-liquidity-v1/PRD.md`](./asymmetric-liquidity-v1/PRD.md)
- [`docs/features/asymmetric-liquidity-v1/SPEC.md`](./asymmetric-liquidity-v1/SPEC.md)
- [`docs/features/asymmetric-liquidity-v1/TASKS.md`](./asymmetric-liquidity-v1/TASKS.md)
- [`docs/features/agent-smart-router-mcp-v1/PRD.md`](./agent-smart-router-mcp-v1/PRD.md)
- [`docs/features/agent-smart-router-mcp-v1/SPEC.md`](./agent-smart-router-mcp-v1/SPEC.md)
- [`docs/features/agent-smart-router-mcp-v1/TASKS.md`](./agent-smart-router-mcp-v1/TASKS.md)
- [`docs/features/exchange-auth-contract-alignment-v1/PRD.md`](./exchange-auth-contract-alignment-v1/PRD.md)
- [`docs/features/exchange-auth-contract-alignment-v1/SPEC.md`](./exchange-auth-contract-alignment-v1/SPEC.md)
- [`docs/features/exchange-auth-contract-alignment-v1/TASKS.md`](./exchange-auth-contract-alignment-v1/TASKS.md)
- [`docs/features/social-copytrade-v1/PRD.md`](./social-copytrade-v1/PRD.md)
- [`docs/features/social-copytrade-v1/SPEC.md`](./social-copytrade-v1/SPEC.md)
- [`docs/features/social-copytrade-v1/TASKS.md`](./social-copytrade-v1/TASKS.md)
- [`docs/features/production-readiness-v1/PRD.md`](./production-readiness-v1/PRD.md)
- [`docs/features/production-readiness-v1/SPEC.md`](./production-readiness-v1/SPEC.md)
- [`docs/features/production-readiness-v1/TASKS.md`](./production-readiness-v1/TASKS.md)

## Regras

1. Use o [`../prd/PROJECT_PRD.md`](../prd/PROJECT_PRD.md) como baseline de produto.
2. Use o [`../specs/PROJECT_SPEC.md`](../specs/PROJECT_SPEC.md) como baseline de arquitetura.
3. Se a feature mudar contratos públicos ou decisões transversais, atualize também os documentos canônicos.

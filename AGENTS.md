# AGENTS.md

Regras versionadas para agentes e pessoas trabalhando no Lunex.

## Ordem de Trabalho

Use SDD para qualquer feature, refactor estrutural ou bugfix com impacto em mais de um arquivo:

```text
/PRD -> /Spec -> /Break -> /Plan -> /TDD -> Implement -> /PR
```

- `/PRD`: alinhe problema, usuário, objetivo, escopo e critérios de sucesso.
- `/Spec`: escreva a solução técnica, contratos, arquivos permitidos e riscos antes do código.
- `/Break`: quebre a SPEC em tarefas pequenas com `Files`, `Acceptance`, `Verify`, `Boundary` e `Risk`.
- `/Plan`: pesquise o código existente, padrões locais, testes e dependências antes de editar.
- `/TDD`: comece mudança de comportamento por teste ou ajuste de teste quando viável.
- `Implement`: execute uma tarefa por vez e atualize `TASKS.md`.
- `/PR`: entregue checklist de rastreabilidade, validação e riscos residuais.

## Documentos Canônicos

- Produto: `docs/prd/PROJECT_PRD.md`
- Arquitetura: `docs/specs/PROJECT_SPEC.md`
- Workflow SDD: `docs/sdd/README.md`
- Feature docs: `docs/features/<feature-slug>/`
- API pública: `docs/PUBLIC_API_SPECIFICATION.md`
- OpenAPI: `docs/api/openapi.json`

## Ownership por Camada

| Caminho | Dono lógico | Pode alterar | Não deve alterar |
|---|---|---|---|
| `lunes-dex-main/` | Frontend | UI, páginas, componentes, hooks, estado visual, chamadas de API/SDK | Regra financeira, autorização, matching, settlement, rewards, liquidação, pricing crítico |
| `spot-api/` | Backend | Rotas, serviços, validação, auth, matching, settlement orchestration, Prisma, Redis, WebSocket | UI, decisão visual, regra on-chain divergente |
| `Lunex/contracts/` | Smart contracts | Invariantes on-chain, custody, liquidez, settlement final, permissões | Estado efêmero de UI ou regra que depende apenas do banco |
| `sdk/` | SDK | Tipos, clientes, helpers e contratos públicos | Regra de negócio nova sem backend/contract correspondente |
| `mcp/` | Agentes | Ferramentas sobre `spot-api`, assinatura externa, escopos e API keys | Bypass de auth, assinatura custodial não especificada, regra financeira própria |
| `lunex-admin/` | Admin | Operação interna, dashboards, revisão, ativação, auditoria | Schema divergente ou regra crítica sem sync com `spot-api` |
| `subquery-node/` | Indexação | Mapping e tipos do indexador | Regras autoritativas de trading ou custody |

## Guardrail de Frontend

Frontend não pode ser fonte de verdade para regra de negócio.

Permitido no frontend:

- validação leve de formulário;
- cálculo visual para preview;
- estados de loading, erro e empty state;
- preparação de payload e assinatura externa pelo usuário;
- seleção de rotas, abas, filtros e preferências de UI.

Proibido como fonte de verdade no frontend:

- autorização;
- cálculo final de fees, rewards, comissões, liquidação, margem ou settlement;
- matching de ordens;
- decisão de risco;
- ativação de plano, listagem ou permissão administrativa;
- qualquer regra financeira que não seja repetida no backend ou no contrato.

## Isolamento de Pastas e Comportamentos

- Uma tarefa deve ter um comportamento principal.
- Uma tarefa deve listar os arquivos esperados antes da implementação.
- Evite tocar mais de 5 arquivos de produção por tarefa. Se precisar, quebre por camada.
- Não misture feature, refactor amplo, ajuste visual e migração no mesmo item sem justificar na SPEC.
- Não altere código gerado, `node_modules`, `target`, `dist`, `build`, `.next` ou artefatos de deploy.

## Admin e Schema Prisma

`lunex-admin/` é um subprojeto separado e ignorado pelo repo raiz. Se uma mudança tocar dados compartilhados:

- compare `spot-api/prisma/schema.prisma` com `lunex-admin/prisma/schema.prisma`;
- declare qual schema é fonte de verdade;
- inclua tarefa de sync quando modelos, enums ou relações mudarem;
- valide build ou typecheck dos dois lados quando o admin consumir o modelo alterado.

## Testes e Gates

Use o menor conjunto de testes que cobre o risco da tarefa, e aumente a cobertura quando tocar contratos públicos ou dinheiro.

- `spot-api/`: `npm run build`, `npm test`, `npm run quality`
- `lunes-dex-main/`: `npm run build`, `npm run quality`
- `sdk/`: `npm run build`, `npm test`, `npm run quality`
- `mcp/lunex-agent-mcp/`: `npm run build`, `npm test`, `npm run quality`
- contratos: `cargo test --workspace --exclude fuzz`, `cargo clippy --workspace --exclude fuzz -- -D warnings`

Se um comando não puder rodar, registre o motivo no PR.

## Segurança

- Nunca commite `.env`, seeds, private keys, tokens, mnemonics ou secrets.
- Não use seeds de desenvolvimento em produção.
- Operações financeiras, custody, assinatura, auth, rewards, listing, settlement e margin exigem SPEC e plano de teste.
- Rotas admin devem exigir autenticação forte e logs/auditoria quando alterarem estado.

## Pull Requests

Todo PR de feature ou bugfix relevante deve responder:

- PRD foi criado ou atualizado?
- SPEC foi criada ou atualizada?
- TASKS foram quebradas em unidades pequenas?
- Arquivos alterados batem com `Files`?
- Testes foram criados/ajustados?
- Frontend ficou sem regra de negócio crítica?
- Backend/contratos validam a regra autoritativa?
- Riscos residuais e gaps foram registrados?

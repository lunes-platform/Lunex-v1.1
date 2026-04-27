# [Feature Name] TASKS

**Owner:**  
**SPEC:**  
**Status:** not-started | in-progress | blocked | done  

## Definition of Done

- Cada tarefa concluída tem aceite verificável.
- Testes foram criados/ajustados desde o início quando houve mudança de comportamento.
- `Verify` foi executado ou o gap foi registrado.
- Docs foram atualizadas quando contratos públicos, arquitetura ou fluxos mudaram.
- O frontend não contém regra de negócio financeira, autorização ou validação crítica como fonte de verdade.

## Task Rules

- Uma tarefa deve alterar um comportamento ou contrato verificável.
- Uma tarefa deve listar arquivos esperados em `Files`.
- Uma tarefa deve declarar a fronteira de camada em `Boundary`.
- Uma tarefa deve ter um comando ou checagem objetiva em `Verify`.
- Evite tarefas que alterem mais de 5 arquivos de produção. Se precisar, quebre por camada.
- Não misture refactor, feature, teste e docs em uma única tarefa sem justificativa.

## Tasks

- [ ] Task 1: Refinar PRD e alinhar dúvidas abertas
  - Files:
    - `docs/features/<feature-slug>/PRD.md`
  - Acceptance:
    - Problema, usuário, metas, fora de escopo e critérios de sucesso estão claros.
  - Verify:
    - Revisão documental do PRD contra `docs/prd/PROJECT_PRD.md`.
  - Boundary:
    - Docs only.
  - Risk:
    - Escopo ambíguo gerar implementação fora do objetivo.

- [ ] Task 2: Aprovar SPEC e validar impactos entre módulos
  - Files:
    - `docs/features/<feature-slug>/SPEC.md`
  - Acceptance:
    - SPEC lista módulos impactados, arquivos permitidos, contratos, testes, rollout e riscos.
  - Verify:
    - Revisão documental da SPEC contra `docs/specs/PROJECT_SPEC.md`.
  - Boundary:
    - Docs only.
  - Risk:
    - Mudança cross-layer sem contrato claro.

- [ ] Task 3: Implementar primeira unidade de comportamento
  - Files:
    - `path/to/source-file`
    - `path/to/test-file`
  - Acceptance:
    - Comportamento descrito na SPEC funciona sem alterar arquivos fora de escopo.
  - Verify:
    - `npm test -- --runTestsByPath path/to/test-file`
  - Boundary:
    - Declare frontend | backend | contracts | sdk | admin | mcp.
  - Risk:
    - Declare o principal modo de falha.

- [ ] Task 4: Atualizar contratos públicos, SDK ou docs se necessário
  - Files:
    - `sdk/src/...`
    - `docs/...`
  - Acceptance:
    - Consumidores externos têm tipos, docs e exemplos alinhados ao contrato real.
  - Verify:
    - `npm run build`
  - Boundary:
    - SDK/docs only, salvo exceção justificada.
  - Risk:
    - Breaking change sem rollout.

- [ ] Task 5: Validação final e evidências
  - Files:
    - `docs/features/<feature-slug>/TASKS.md`
    - `docs/features/<feature-slug>/QA.md`
  - Acceptance:
    - Evidências de teste, gaps e riscos residuais estão registrados.
  - Verify:
    - Executar os comandos definidos na SPEC ou registrar por que não puderam rodar.
  - Boundary:
    - Docs/test evidence.
  - Risk:
    - PR aprovado sem rastreabilidade de validação.

## Risks / Blockers

- Dependência externa 1
- Decisão pendente 1

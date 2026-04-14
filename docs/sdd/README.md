# SDD Workflow

Neste projeto, **SDD** significa usar especificação como artefato de desenvolvimento, não só como documentação posterior. Em prática: primeiro alinhamos o problema no PRD, depois desenhamos a solução na SPEC, depois executamos com `TASKS.md`.

## Artefatos Obrigatórios

Para toda feature nova de médio ou grande porte, crie uma pasta em `docs/features/<feature-slug>/` com:

- `PRD.md`: define problema, usuários, metas, escopo e critérios de sucesso.
- `SPEC.md`: define solução técnica, impacto em módulos, contratos de interface, rollout e testes.
- `TASKS.md`: quebra a execução em passos verificáveis.

Artefatos opcionais:

- `ADR.md`: decisões técnicas com trade-offs.
- `QA.md`: plano ou evidência de validação.
- `ROLL_OUT.md`: rollout, flags, migração e operação.

## Estrutura Recomendada

```text
docs/features/<feature-slug>/
  PRD.md
  SPEC.md
  TASKS.md
  ADR.md
  QA.md
```

## Fluxo de Trabalho

### 1. Discovery

- Identifique o problema, o público e o valor esperado.
- Use o PRD para separar o que é objetivo real do que é solução presumida.
- Aponte dependências com docs existentes e lacunas de contexto.

### 2. Solution Design

- Traduza o PRD em uma SPEC implementável.
- Declare módulos impactados, contratos, migrations, riscos e estratégia de teste.
- Se a feature tocar mais de uma camada, a SPEC deve mostrar a costura entre elas.

### 3. Execution

- Quebre a SPEC em tarefas pequenas o suficiente para implementação e revisão.
- Atualize `TASKS.md` ao longo do trabalho, não apenas no fim.
- Se a solução mudar, ajuste a SPEC antes ou junto do código.

### 4. Validation

- Execute testes coerentes com o risco da mudança.
- Registre gaps quando algo não puder ser validado.
- Atualize docs canônicas quando a feature mudar comportamento transversal.

## Gates Mínimos

### Gate de Higiene de Código

- Cada módulo alterado deve expor `npm run quality` (ou equivalente) cobrindo:
  - `ESLint` para validação estática de código;
  - `ts-prune` para exports mortos;
  - `depcheck` para dependências não usadas/faltantes;
  - `Prettier --check` para consistência de formatação.
- O pipeline de PR deve bloquear merge quando qualquer `quality gate` aplicável falhar.

### Um PRD bom precisa responder

- qual problema estamos resolvendo;
- para quem;
- por que agora;
- quais metas e limites definem sucesso;
- o que explicitamente ficou fora de escopo.

### Uma SPEC boa precisa responder

- quais módulos serão alterados;
- quais interfaces, dados ou contratos mudam;
- quais riscos e modos de falha existem;
- como será feito rollout, migração e teste.

### Um TASKS bom precisa responder

- qual sequência de execução faz sentido;
- como saber que cada etapa terminou;
- o que ainda está bloqueado ou em aberto.

## Exceções

- **Bugfix pequeno:** pode pular `PRD.md`, mas deve ter ao menos uma mini-SPEC e tarefas rastreáveis no PR ou em `docs/features/<bug-slug>/`.
- **Hotfix emergencial:** o código pode vir primeiro, mas a SPEC e o registro do problema devem ser atualizados logo após estabilização.
- **Mudança puramente editorial:** não precisa abrir pasta de feature.

## Adoção no Brownfield

O Lunex já possui bastante documentação legada. A adoção do SDD aqui segue estas regras:

1. Não mover tudo de uma vez.
2. Usar `docs/prd/PROJECT_PRD.md` e `docs/specs/PROJECT_SPEC.md` como baseline canônica.
3. Toda iniciativa nova entra no fluxo SDD.
4. Conforme features forem revisitadas, absorver o conteúdo histórico necessário para a nova estrutura.

## Templates

- [`PRD_TEMPLATE.md`](./templates/PRD_TEMPLATE.md)
- [`SPEC_TEMPLATE.md`](./templates/SPEC_TEMPLATE.md)
- [`TASKS_TEMPLATE.md`](./templates/TASKS_TEMPLATE.md)

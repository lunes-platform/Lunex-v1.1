# SDD Workflow

Neste projeto, **SDD** significa usar especificação como artefato de desenvolvimento, não só como documentação posterior. Em prática: primeiro alinhamos o problema no PRD, depois desenhamos a solução na SPEC, quebramos a solução em tarefas pequenas e só então implementamos com testes.

O fluxo operacional padrão é:

```text
/PRD -> /Spec -> /Break -> /Plan -> /TDD -> Implement -> /PR
```

Esses comandos são convenções de trabalho para issues, PRs e agentes. Eles não dependem de uma CLI específica.

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

### /PRD

- Declare o problema, o usuário, o valor esperado e o que fica fora do escopo.
- Atualize `docs/prd/PROJECT_PRD.md` quando a mudança alterar a visão transversal do produto.
- Para features médias ou grandes, crie ou atualize `docs/features/<feature-slug>/PRD.md`.

### /Spec

- Escreva a solução antes do código.
- A SPEC deve cobrir `page`, `behavior`, `component`, API, dados, contratos, rollout e testes quando aplicável.
- Declare arquivos ou pastas permitidos para alteração e arquivos explicitamente fora de escopo.
- Declare onde a regra de negócio vive. Regra financeira, autorização, settlement, matching, recompensas e pricing não podem ter o frontend como fonte de verdade.

### /Break

- Quebre a SPEC em tarefas pequenas em `TASKS.md`.
- Cada tarefa deve ter `Files`, `Acceptance`, `Verify`, `Boundary` e `Risk`.
- Uma tarefa deve alterar um comportamento verificável e, como regra prática, evitar tocar mais de 5 arquivos de produção.

### /Plan

- Antes de implementar uma tarefa, pesquise o código existente e siga padrões locais.
- Identifique os arquivos exatos a mexer, dependências, testes existentes e riscos.
- Se o plano descobrir mudança de escopo, atualize a SPEC antes do código.

### /TDD

- Para mudança de comportamento, escreva ou ajuste testes antes ou junto da implementação.
- Bugfix deve começar com teste que reproduz o problema quando viável.
- Mudanças documentais podem ser validadas com revisão, links e checklist de consistência.

### Implement

- Execute uma tarefa por vez.
- Respeite ownership por pasta e camada.
- Atualize `TASKS.md` conforme cada tarefa for concluída.
- Não misture refactor amplo com entrega funcional sem tarefa separada.

### /PR

- O PR deve ligar PRD, SPEC, TASKS, testes executados e riscos restantes.
- O checklist de PR deve confirmar que o frontend não virou fonte de regra de negócio.
- Mudanças fora dos arquivos planejados precisam ser justificadas.

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

Regras de granularidade:

- cada tarefa deve ter um único objetivo comportamental;
- cada tarefa deve listar arquivos ou diretórios esperados em `Files`;
- cada tarefa deve ter um comando ou verificação objetiva em `Verify`;
- tarefas cross-layer devem explicar a costura entre frontend, backend, contratos, SDK e admin.

### 4. Validation

- Execute testes coerentes com o risco da mudança.
- Registre gaps quando algo não puder ser validado.
- Atualize docs canônicas quando a feature mudar comportamento transversal.

## Gates Mínimos

### Gate de Arquitetura por Camada

- `lunes-dex-main/` e UI do `lunex-admin/` orquestram experiência, estado visual, chamadas e assinaturas de usuário. Não são fonte de regra financeira ou autorização.
- `spot-api/` concentra validação de payload, autorização, regras off-chain, matching, settlement orchestration, rate limit, persistência e integrações externas.
- `Lunex/contracts/` concentra invariantes on-chain, custody, liquidez, settlement final e regras que precisam ser verificáveis pela rede.
- `sdk/` espelha contratos públicos de API/chain. Não deve inventar comportamento diferente do backend ou dos contratos.
- `mcp/` expõe ferramentas para agentes respeitando escopos, assinaturas externas e chaves de API. Não deve contornar validação do backend.
- `lunex-admin/` é fronteira operacional separada. Qualquer duplicação de schema Prisma precisa de tarefa explícita de sync com `spot-api/prisma/schema.prisma`.

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
- quais arquivos devem ser alterados;
- qual fronteira de camada a tarefa deve respeitar;
- como verificar que a regra de negócio não vazou para a camada errada.

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

# TASKS — soak 46h

## T1 — controle e proteção local

- Files: `scripts/soak/core.cjs`, `core.test.cjs`, `chain.cjs`.
- Acceptance: prazo absoluto, localhost/genesis, journal e cálculo financeiro exato; RPC falho não vira saldo zero.
- Verify: node:test e node --check.
- Boundary: não mudar API/contratos/frontend.
- Risk: replay após crash; fail closed em efeito incerto.
- Status: concluído;14testes node:test aprovados (inclui exclusão mútua, bindloopback e CLIstart/stop sem renovação de prazo).

## T2 — provisionamento isolado

- Files: `scripts/soak/setup.cjs` e `chain.cjs`.
- Acceptance: seeds privadas, saldos reais conferidos, vault com assinaturas, pool e banco isolados, snapshot reproduzível.
- Verify: RPC readback, migrations e health da API.
- Boundary: nenhum reset e nenhum fundo externo.
- Risk: nonce compartilhado de Alice apenas durante setup serial; execução usa relayer próprio.
- Status: concluído;fundingreadback validado, assinaturas obrigatórias, dois pools próprios e snapshot isolado.

## T3 — operações e navegador

- Files: `scripts/soak/worker.cjs`, `browser.cjs`, `core.test.cjs`.
- Acceptance: receitas positivas/negativas reais, conservação e tx finalizadas, HTTP/WS e Chromium, carga limitada.
- Verify: canário cobrindo todas as receitas antes da janela longa.
- Boundary: assimétrico simulado não conta como volume real.
- Risk: ordem FILLED ainda não liquidada; esperar SETTLED e conferir ledger.
- Status: concluído;13receitas/23trades/5negativas, swaps, wrap/vault/LP eChromium aprovados;4falhas de automação reconciliadas e documentadas noQA.

## T4 — supervisão e início

- Files: `scripts/soak/supervisor.cjs`, `control.cjs`, `api.cjs`; documentos QA/README.
- Acceptance: job fora da conversa, reinício preserva deadline, stop/status funcionam; início/fim e evidência inicial registrados em ai-memory.
- Verify: canário, falha/reinício controlado sem transação incerta, health e primeiros ciclos da janela46h.
- Boundary: não publicar serviços ou chaves.
- Risk: desligamento/sono limita execução; reportar downtime e não declarar46h antes do término.
- Status: concluído;LaunchAgent ativo/reinício validado e7ciclos iniciais conferidos (12trades/7swaps), healthsaudável. Janela18/10/2026 17:21:36 →20/10/2026 15:21:36(Brasília) permanece em andamento. O término46h será observado pelo supervisor; não está declarado concluído.

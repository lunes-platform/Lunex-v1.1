# SPEC — soak local 46h

## Desenho

Harness CommonJS em `scripts/soak/`, usando dependências instaladas do spot-api e Playwright local. Diretório persistente privado fora do Git em `/Users/lucas/.local/state/lunex-soak/`; seeds e env com modo0600, diretório0700. Snapshot de scripts, dist API, ABIs e build frontend impede que edições posteriores mudem esta execução; node_modules compartilhado permanece uma dependência local.

Serviços próprios: API4200/WS4201, frontend3200, banco `lunex_soak_20261018`, RedisDB10, vault/tokens/pool próprios. Nó existente9944 é preservado e seu genesis é fixado no manifesto. Apenas endpoints localhost e cadeia Development são permitidos, com native decimals8 conferidos. Main API4000 continua com settlement desabilitado.

Quatro traders aleatórios, um provedor de liquidez, treasury e relayer aleatórios. Supply sintético amplo; por trader wallet5M BASE/20M USD e vault10M BASE/100M USD; funding nativo1000LUNES por carteira. Pool100M BASE/200M USD; tradesSpot1k..50k BASE, swaps1k..20k unidades. Gas e fees medidos, fundos finitos sem replenishment ilimitado. Assinaturas sr25519v2 e attestor ECDSA continuam exigidos.

## Execução e invariantes

- Worker serializa operações financeiras; API utiliza relayer exclusivo e concorrência1. Cada ciclo alterna usuários/direções e receita de book; nenhuma nova receita após deadline/stop. Cadência mínima60s; latência da cadeia pode aumentar o intervalo.
- Journal persistido antes de efeitos: operação ativa, extrinsic assinada/hash/nonce antes de broadcast e ordem assinada antes de POST. Interrupção em efeito incerto bloqueia novas operações financeiras e preserva provas para revisão; nunca reenviar automaticamente uma operação incerta. Serviços e monitoramento continuam.
- Extrinsics aguardam finalização, dispatch success e invariantes posteriores. Swaps conferem input/output, reservas, produto e fee995/1000 com referência inteira independente. Spot confere ledger dos4 usuários e fees após todos os fills SETTLED; custody dos tokens deve corresponder ao ledger+fees.
- Falhas de rede antes de efeitos podem repetir após backoff. HTTP429 respeita Retry-After; requests mutantes sem resposta não são reenviados. Falha de saldo/invariante ou settlement incerto aciona circuito financeiro.
- Teste de liquidez e vault usa carteiras próprias e ocorre sem ordens pendentes; saques não invalidam as reservas do book. LP e tokens do usuário são conferidos após a operação. Wrap/unwrap usa native8, não12.
- Leituras públicas e WS em carga moderada, sem aumentar/desativar rate limits. Navegador periódico verifica interação assinada de wallet, criar/cancelar no book, páginasSwap/Pools e mobile; um processo Chromium por vez.
- Checkpoints atômicos, contadores por operação, notional separado por ativo, latência/statusHTTP, tx hashes, downtime, erros e resultado financeiro. Logs rotacionados; disponibilidade amostrada não é prova de uptime contínuo entre amostras.

## Supervisão e operação

LaunchAgent macOS com RunAtLoad/KeepAlive do supervisor; reinícios conservam startedAt/deadline. Supervisor reinicia somente seus próprios API/frontend/worker, verifica nó/DB/Redis e registra incidentes. Nó compartilhado só é reiniciado com os mesmos argumentos/base-path se estiver ausente; sem reset. `caffeinate -i` durante a janela evita idle sleep (não impede tampa fechada/desligamento). Limites de memória Node e logs, prioridade nice10, saúde a cada30s, browser a cada15min.

Prazo encerra novas receitas e permite drenar a receita já iniciada; cada extrinsic tem timeout180s. Relatório distingue término da janela e drenagem, congela a amostragem da janela e marca interrupções/gaps sem declarar46h íntegros. Serviços frontend/backend permanecem disponíveis até comando explícito de parada. Status e controle usam CLI e arquivos locais, sem portas administrativas novas.

## Arquivos e gates

Somente `scripts/soak/*` e estes documentos. Nenhuma mudança financeira de produção planejada. Se surgir defeito do produto, registrar/reproduzir e criar tarefa separada antes de corrigir. Gates: node:test do controlador/guardas/restart/accounting; node --check; canário com todos os tipos de receita, swaps, vault, LP, wrap e navegador; smoke dos serviços e job launchd após início. Gates anteriores da aplicação permanecem documentados em asymmetric-spot-qa-v1/QA.md.

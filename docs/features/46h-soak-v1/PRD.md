# PRD — operação contínua local por 46 horas

Solicitação: manter frontend, backend e Lunes local disponíveis e executar operações de alto volume em segundo plano, com carteiras novas e fundos de desenvolvimento, enquanto outros projetos são usados.

## Aceitação

- Janela absoluta de 46 horas iniciada depois de um canário financeiro aprovado; reiniciar não renova o prazo.
- Carteiras sr25519 exclusivas, relayer/attestor próprios, PSP22 de teste e vault, banco PostgreSQL e Redis isolados. Nenhum saldo público ou dado anterior é apagado.
- Swaps reais com mínimo de saída/deadline; LIMIT, MARKET, partial fills, IOC, FOK, STOP/STOP_LIMIT, cancelamento e leituras assinadas; wrap/unwrap, depósitos/saques e liquidez.
- Sucesso financeiro exige finalização e conferência de saldos/fees. FILLED não equivale a SETTLED.
- Supervisão independente da conversa, monitoramento de serviços/blocos, checagens periódicas Chromium desktop/mobile, relatórios e comandos de status/parada.
- Carga limitada por finalização serial e rate limits existentes, sem monopolizar CPU/memória/disco. Alto volume significa valores altos e repetição prolongada; throughput real é medido, nunca presumido.

## Limites

A máquina precisa permanecer ligada e acordada. Suspensão/desligamento é indisponibilidade, não tempo testado; a janela não é prorrogada silenciosamente. Liquidez assimétrica financeira não existe na implementação auditada: não contar suas simulações como transferências reais. Não inclui margem, bridge externa nem bloqueio de staking de longa duração.

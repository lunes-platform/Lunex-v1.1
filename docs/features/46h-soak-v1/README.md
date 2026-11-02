# Operar o teste local de 46 horas

Run: `/Users/lucas/.local/state/lunex-soak/run-20261018`.

Janela ativa: **18/10/2026 17:21:36 →20/10/2026 15:21:36 (Brasília)**. HoráriosUTC:2026-10-18T20:21:36.576Z →2026-10-20T18:21:36.576Z. A execução continua em background; o resultado completo só existe depois da deadline e drenagem.

- Aplicação: http://127.0.0.1:3200/spot
- Painel: http://127.0.0.1:3200/__soak
- StatusJSON: http://127.0.0.1:3200/__soak/status
- API/WS: `127.0.0.1:4200` / `4201`; bind loopback pelo adaptador de testes `api.cjs`.
- Nó compartilhado:9944/9933. Ambientes anteriores3000/3100/4000/4100 preservados.

## Consultar e parar a carga

```sh
node /Users/lucas/.local/state/lunex-soak/run-20261018/runtime/soak/control.cjs /Users/lucas/.local/state/lunex-soak/run-20261018 status
node /Users/lucas/.local/state/lunex-soak/run-20261018/runtime/soak/control.cjs /Users/lucas/.local/state/lunex-soak/run-20261018 stop
launchctl print gui/501/io.lunex.soak46h
```

`stop` encerra novas receitas e deixa a operação atual terminar; frontend/API continuam disponíveis. É intencional que o supervisor permaneça ativo depois das46h. Para desligar também esses serviços, primeiro aguarde `activeOperation` vazio e worker encerrado; depois:

```sh
launchctl bootout gui/501/io.lunex.soak46h
```

Não reinicie a janela com outro `start`: o controlador recusa sobrescrever startedAt/deadline.

## Carteiras e fundos

`manifest.json` contém apenas endereços/configuração públicos. `funding-readback.json` comprova o abastecimento. São4traders e3contas operacionais aleatórias. Supply exclusivamente local; por trader:

| Local | BASE8dec | USD6dec | LUNES8dec |
|---|---:|---:|---:|
| Wallet |5.000.000|20.000.000|aprox.999após gas/depósito|
| Vault |10.000.000|100.000.000|1|

`wallets.secrets` e `api.env` são privados; não copiar para Git, mensagens ou relatórios. O frontend usa os slots de configuração de teste GMC/LUSDT para os tokens sintéticos SB46/SUSD46; o Spot exibe o par real `SB46/SUSD46`. Os slots não tornam esses ativos públicos nem representativos de moedas reais.

## Carga e disponibilidade

-13receitas de book em rotação;1000..50000BASE por lote, direções e usuários alternados. Fills finais e fees conferidos independentemente.
- Swap real por ciclo com mínimo de saída/deadline,1000..20000unidades; produto/reservas/deltas conferidos.
- A cada10ciclos: wrap/unwrap, vault ou add/removeLP em rotação.
- HTTP book a cada3s (até20/min), WS contínuo; leituras privadas assinadas por ciclo. Rate limits originais continuam ativos.
- Chromium desktop/mobile a cada15min: criar/cancelar ordem assinada, swap nativo real pela UI com prova de finalização, páginasSwap/Pools e overflowmobile.
- Cadência mínima60s por ciclo; a finalização da cadeia pode torná-la maior. Alto volume é notional sintético e duração, sem promessa de TPS arbitrário.
- NodeAPI/worker com heap512MB cada, supervisor256MB; nice10. Um Chromium por vez. Logs10MB×9porstream e screenshots sobrescritos.
- Health a cada30s; monitora API/DB/Redis, frontend e avanço do bloco finalizado. Amostragem não comprova uptime entre amostras. Gaps de supervisão ficam separados.
- LaunchAgent com reinício; caffeinate evita idle sleep durante a janela. Máquina desligada, logout ou tampa fechada podem interromper execução. Após retorno, a deadline original permanece; gaps não contam como teste executado.

## Arquivos de acompanhamento

`control.json`: início/deadline e baselines. `worker-state.json`: checkpoint/counters/journal. `events.jsonl`: operações, txhashes e conferências. `supervisor-state.json` e `supervisor.jsonl`: saúde/reinícios/gaps. `browser-latest.json` e screenshots: última rodadaChromium. `canary.json`: pré-condição financeira. `report.json`: resultado após encerrar/drenar a janela. Counters no painel descontam o canário/setup.

Se `financialHalted` estiver preenchido, serviços continuam, mas não há novas operações financeiras. Inspecionar a ordem/tx no journal, banco e cadeia antes de qualquer intervenção. Não limpar flags, reenviar requests nem alterar o banco para esconder falhas. Um supervisor reiniciado pode adotar processos antigos; lock impede um segundo worker.

AsymmetricPair continua um protótipo sem custódia/entrega financeira comprovada; seu volume não faz parte deste teste. Margin, bridges externas e staking com bloqueio também não integram esta rodada.

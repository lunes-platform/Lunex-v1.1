# Validação da liquidez assimétrica, roteamento híbrido e Spot

## Solicitação

Após o QA local de swap/liquidez, analisar a proposta de liquidez híbrida/assimétrica, conferir os parâmetros e o objetivo de reduzir derrapagem. Depois testar negociações Spot e todas as operações disponíveis do book.

## Referências

- Proposta econômica: `docs/requisitonovo.md`, especialmente equação inicial e Smart Router híbrido.
- Contrato alvo V1: `docs/features/asymmetric-liquidity-v1/{PRD,SPEC,TASKS}.md`.
- Arquitetura canônica e `docs/SPOT_ORDERBOOK_ARCHITECTURE.md`.
- Ambiente e QA anterior: `docs/features/local-browser-qa-v1/QA.md`.

## Critérios de sucesso

- Comparar parâmetros/documentos com contrato, UI, backend e resultados reais.
- Medir output, preço médio, impacto de preço, fees, capacidade e diferença entre quote e execução; não inferir impacto zero apenas por continuidade da curva.
- Distinguir simulação matemática, intenção de execução e movimentação financeira comprovada.
- Exercitar compra/venda LIMIT, MARKET, STOP e STOP_LIMIT; GTC, IOC e FOK; prioridade preço/tempo, fills parciais/totais, cancelamento, histórico, saldos travados e disponíveis, fees e liquidação.
- Verificar assinatura, nonce/replay, expiração, saldo insuficiente e operações não autorizadas.
- Executar provas locais com usuários de desenvolvimento e dados identificados de QA; preservar dados existentes.
- Corrigir bugs reproduzidos com SPEC e testes; registrar lacunas arquiteturais/econômicas sem inventar regras de protocolo.

## Escopo operacional

Rede Lunes local real, frontend/API/DB/Redis atuais. Usar pares/contas de desenvolvimento isolados quando necessário. Nenhuma publicação ou operação em rede pública.

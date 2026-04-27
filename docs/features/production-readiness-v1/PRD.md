# PRD — Production Readiness V1

## Problema

O Lunex já possui contratos ink!, API Spot, order book, frontend, admin, scripts de deploy/QA e documentação de testnet local. A revisão técnica com cinco frentes mostrou que isso ainda não equivale a prontidão para produção comercial com fundos reais. Existem lacunas em atomicidade de nonces, autorização de API keys, garantias de settlement, invariantes on-chain, operação multi-instância, configuração de deploy, observabilidade e compliance.

## Usuários

- Trader spot que deposita saldo, cria ordens, cancela ordens e espera execução justa.
- Provedor de liquidez que usa Pair/Router/AsymmetricPair e espera invariantes de reserva.
- Agente de IA ou bot que opera por API key com escopos limitados.
- Operador/admin que lista tokens, audita eventos, faz deploy e responde incidentes.
- Auditor externo que precisa verificar regras de negócio, logs e evidência de testes.

## Objetivos

1. Transformar o lançamento comercial em um gate explícito, com critérios objetivos de aceite.
2. Fechar riscos P0 que permitam replay, privilege escalation, fundos travados, settlement incorreto, operação inconsistente ou bypass administrativo.
3. Separar o que está liberado para testnet/local do que ainda bloqueia mainnet comercial.
4. Exigir TDD em toda mudança de regra de negócio ou segurança.
5. Manter rastreabilidade SDD entre requisito, decisão técnica, tarefa, teste e risco residual.

## Fora de Escopo

- Reescrever toda a DEX em uma única entrega.
- Aprovar lançamento comercial apenas por build/teste local.
- Tratar frontend, admin ou scripts como fonte final de regra financeira.
- Corrigir compliance jurídico sem validação com responsáveis legais.

## Gate Comercial

Produção comercial só pode ser aprovada quando todos os itens P0 em `TASKS.md` estiverem concluídos, com testes automatizados, deploy reproduzível e plano de resposta a incidentes. Enquanto houver P0 aberto, o ambiente deve ser classificado como desenvolvimento, QA, testnet ou beta fechado sem fundos reais significativos.

## Critérios de Sucesso

- Nonces de ações assinadas são consumidos de forma atômica e falham fechados em produção.
- API keys não conseguem criar chaves com permissões que a chave atual não possui.
- Ordem, matching, persistência e settlement possuem modelo de falha documentado e testado.
- Contratos ink! não dependem de rollback implícito de `Result::Err`.
- Deploy local/testnet/prod tem variáveis obrigatórias, health checks e scripts consistentes.
- Frontend e SDK não divergem dos ABIs/artefatos de contrato.
- Admin não consegue burlar regras financeiras críticas por escrita direta.
- Observabilidade cobre API, Redis, PostgreSQL, WS, chain RPC, settlement e filas.

## Riscos Principais

- Perda ou travamento de fundos por contrato que altera estado antes de retornar erro.
- Replay ou corrida de nonce permitindo ação duplicada.
- Escalada de permissão por API key de agente.
- Divergência entre order book em memória, banco e settlement on-chain.
- Deploy com serviços saudáveis no container mas indisponíveis na porta real.
- Operação multi-instância gerando books diferentes por processo.
- Uso comercial sem KYC/AML, trilha de auditoria ou resposta operacional suficiente.

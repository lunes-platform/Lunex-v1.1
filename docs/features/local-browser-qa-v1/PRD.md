# Validação local do Lunex

## Problema e objetivo

Validar a aplicação existente no navegador contra uma rede Lunes local real antes de alterar comportamento. Corrigir falhas reproduzidas no bootstrap, na conexão da carteira e nos fluxos de swap e liquidez.

## Critérios de sucesso

- Nó `lunes-nightly` local produz e finaliza blocos com contratos ink! implantados.
- API conectada a PostgreSQL e Redis; frontend usa os mesmos endereços de contratos.
- Cotações correspondem aos tokens e ao valor atuais; falhas não permitem usar cotações antigas.
- LUNES/WLUNES têm saldo e conversão corretos, incluindo o token acessível pela busca.
- Transações de desenvolvimento executadas pelo navegador e verificadas na blockchain.
- Testes, builds, gates e limitações documentados em `QA.md`.

## Limites

Ambiente local e contas públicas de desenvolvimento. Preservar alterações anteriores, banco existente e regras financeiras dos contratos. Cada correção deve ter reprodução e verificação próprias.

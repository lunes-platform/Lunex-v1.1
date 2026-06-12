# ADR-001 — Verificação de assinatura de ordens no `spot_settlement`

- **Status:** PROPOSTO (aguardando decisão do time)
- **Data:** 2026-06-12
- **Origem:** Auditoria de produção, achado **P0-1** (`.planning/audit-2026-06-12/01-contratos.md`)
- **Decisores:** Time de contratos + chain team (Lunes) + segurança
- **Relacionado:** Gate fail-closed implementado em `Lunex/contracts/spot_settlement/lib.rs` (`signature_verification_enforced`, erro `SignatureVerificationUnavailable`, evento `SignatureEnforcementChanged`)

---

## Contexto

`spot_settlement` custodia saldos reais (nativo LUNES e PSP22) depositados via `deposit_native`/`deposit_psp22`. `settle_trade` (l.549) move esses saldos entre contas com base em duas `SignedOrder` submetidas por um relayer autorizado.

O campo `SignedOrder.signature` (sr25519, 64 bytes) **nunca é verificado criptograficamente on-chain**: `verify_order_signature` (l.1138) apenas rejeitava assinatura toda-zero. Motivo confirmado em runtime: **o lunes-nightly atual NÃO expõe `sr25519_verify` no pallet-contracts** (dependência EXT-CRYPTO aberta). O ink! 4.2.1 também não tem binding para essa host function (ela só aparece como API estável a partir do ink! 5.x / pallet-contracts mais recente).

Consequência: o modelo de segurança reduzia-se a "confie no relayer". Um relayer comprometido pode forjar qualquer assinatura não-zero e drenar todos os depósitos custodiais. A auditoria classificou como P0 e exigiu **redesign, não patch**.

**Mitigação imediata já aplicada (não substitui esta decisão):** gate fail-closed `signature_verification_enforced` (default `true`) que bloqueia `settle_trade` com `SignatureVerificationUnavailable` enquanto não existe verificação on-chain. Desabilitar exige o owner e emite evento auditável. Mainnet **não pode** operar com o gate desabilitado — este ADR decide como reabilitar settlement com segurança real.

Restrições relevantes do projeto:
- Stack congelada na milestone: ink! 4.2.1 (migração para ink! 5 é mudança de toolchain + runtime, fora do escopo atual — ver `CLAUDE.md` Constraints).
- O relayer (`RELAYER_SEED` no spot-api) já verifica sr25519 off-chain via `@polkadot/util-crypto` (`settlementService.ts`) — isso continua obrigatório em qualquer opção.
- Auditoria externa (EXT-AUDIT) na sequência: a opção escolhida precisa estar implementada e testada antes do handoff.

---

## Opções consideradas

### Opção (a) — Aguardar `sr25519_verify` on-chain (EXT-CRYPTO) com payload canônico versionado

O chain team da Lunes atualiza o runtime (pallet-contracts com a host function `sr25519_verify`); o contrato passa a verificar a assinatura do próprio maker dentro de `verify_order_signature`, sobre o payload canônico `build_order_message()` com prefixo versionado (`lunex:vN:spot-order\n`).

| Dimensão | Avaliação |
|---|---|
| **Confiança** | Máxima. Trustless: a assinatura verificada é a da própria wallet do usuário (sr25519). Relayer vira mero transportador. |
| **Custo on-chain** | Baixo (uma host function por ordem, 2 por settle). |
| **UX** | Zero mudança — usuário já assina a ordem hoje. |
| **Prazo** | **Indeterminado e fora do controle do time.** Exige: (1) runtime upgrade da Lunes com pallet-contracts mais novo; (2) provavelmente migração ink! 4.2.1 → 5.x para ter o binding `env().sr25519_verify()` (quebra a constraint de stack congelada) OU chamada manual da host function via `ink_env` (frágil, não-portável); (3) redeploy/migração do contrato. |
| **Risco** | Dependência externa dupla (chain team + ink upgrade). O comentário no próprio contrato admite esse bloqueio há tempo. |

Cuidados se/quando implementada: payload **versionado** (`v2`), domínio de assinatura separado de extrinsics (prefixo + wrap `<Bytes>...</Bytes>` compatível com `signRaw` do polkadot.js), rejeição de versão desconhecida, e testes com vetores gerados por `@polkadot/util-crypto`.

### Opção (b) — Order-commitment on-chain (validação na submissão, não na liquidação)

O usuário registra o hash canônico da ordem (`build_order_hash`) **a partir da própria conta** — nova mensagem `commit_order(order_hash: [u8; 32])` (ou junto do depósito). A autenticação vem da **origem da extrinsic** (a chain já verifica a assinatura da transação), eliminando a necessidade de verificar assinatura dentro do contrato. `settle_trade` só liquida ordens cujo hash foi previamente registrado pelo `maker`:

```rust
// storage
committed_orders: Mapping<(AccountId, [u8; 32]), bool>,

// settle_trade
if !self.committed_orders.get((order.maker, order_hash)).unwrap_or(false) {
    return Err(SpotError::OrderNotCommitted);
}
```

| Dimensão | Avaliação |
|---|---|
| **Confiança** | Máxima (equivalente à (a)). Trustless: o relayer não consegue inventar ordem que o maker não registrou da própria conta. Cancelamento = remover commitment. |
| **Custo on-chain** | **Alto por ordem**: cada colocação de ordem vira uma extrinsic on-chain (gas + storage deposit + latência de bloco). Mitigável com commit em lote (vetor de hashes) ou merkle root por sessão, ao custo de complexidade. |
| **UX** | **Pior regressão das três.** Mata a vantagem do orderbook off-chain: colocar/editar ordem deixa de ser instantâneo e gratuito; trader ativo paga gas e espera bloco a cada ordem. Market-making fica inviável. |
| **Prazo** | Implementável **hoje** (sem host function nova, sem mudança de runtime). ~1-2 semanas de contrato + mudanças no spot-api/SDK/frontend para o fluxo de commit. |
| **Risco** | Baixo tecnicamente; alto em produto (abandono de UX). Storage cresce por ordem (precisa de expiração/limpeza de commitments). |

Variante mitigada: exigir commitment **apenas acima de um valor-limite** de ordem — reduz dano de UX mas cria dois regimes de segurança (a auditoria tende a rejeitar proteção parcial de custódia).

### Opção (c) — Atestação ECDSA via `env().ecdsa_recover` (2-de-2: relayer + attestor) — host function que JÁ existe no ink! 4

O usuário continua assinando a ordem em sr25519 (zero mudança de wallet/UX). Um **serviço atestador independente** — chave secp256k1 própria, processo, host e segredo separados do relayer — verifica off-chain a assinatura sr25519 do usuário e, se válida, assina em ECDSA o hash canônico da ordem. `settle_trade` recebe a atestação e o contrato:

1. Calcula `hash = blake2x256(build_order_message_v2(order))` (payload com prefixo versionado `lunex:v2:spot-order\n`).
2. `env().ecdsa_recover(&attestation_sig_65, &hash)` → pubkey comprimida 33 bytes.
3. Compara com `attestor_pubkey` armazenado (setado pelo owner, com evento).
4. Mantém a exigência `ensure_relayer_or_owner()` no caller.

Resultado: liquidar exige **duas chaves independentes** (relayer assina a extrinsic; attestor assina a atestação por-ordem). Comprometer só o relayer não permite mais forjar ordens.

```rust
// storage
attestor_pubkey: Option<[u8; 33]>,

// SignedOrder ganha campo (ou settle_trade ganha args):
pub attestation: [u8; 65],   // ECDSA sig do attestor sobre blake2x256(msg_v2)

// novas mensagens
set_attestor_key(pubkey: [u8; 33]) -> Result<(), SpotError>  // owner, emite AttestorKeyChanged
```

| Dimensão | Avaliação |
|---|---|
| **Confiança** | Intermediária-alta. **Não** é trustless: confia que relayer e attestor não conluiam/não são comprometidos juntos. Mas eleva o ataque de "1 segredo" para "2 segredos independentes" (chaves em Doppler/HSM distintos, hosts distintos, equipes de acesso distintas). Auditável: toda atestação é verificada criptograficamente on-chain. |
| **Custo on-chain** | Baixo: `ecdsa_recover` é host function nativa (já usada no ecossistema ink! 4); +65 bytes por ordem no calldata. |
| **UX** | Zero mudança para o usuário. Mudança só no backend (novo serviço attestor + campo na pipeline de settlement). |
| **Prazo** | Implementável **hoje** no ink! 4.2.1. ~1-2 semanas: contrato (recover + key management) + serviço attestor (reusa a verificação sr25519 já existente no spot-api) + testes com vetores secp256k1. |
| **Risco** | Operacional: gestão/rotação da chave attestor (mensagem owner-gated + evento resolve); disponibilidade do attestor vira dependência do settlement (aceitável: settlement já depende do relayer). |

---

## Decisão proposta (recomendação)

**Adotar a Opção (c) — atestação ECDSA 2-de-2 — como mecanismo de desbloqueio do settlement para mainnet, com a Opção (a) como destino final quando EXT-CRYPTO for entregue.** Justificativa:

1. **(a) é a melhor em teoria, mas está bloqueada por dependência dupla fora do controle do time** (runtime Lunes + provável migração ink! 5, que viola a constraint de stack congelada). Não pode ser o plano de mainnet desta milestone; permanece como north star.
2. **(b) é trustless mas destrói o produto**: orderbook off-chain com commit on-chain por ordem elimina a razão de existir do spot off-chain (latência zero, ordem gratuita). Regressão de UX inaceitável para market-making.
3. **(c) é a única opção implementável hoje, sem mudança de UX, que melhora materialmente o modelo de confiança** ("1 chave drena tudo" → "2 chaves independentes precisam ser comprometidas simultaneamente"), com verificação criptográfica real on-chain (`ecdsa_recover`) e trilha auditável.

Desenho para compatibilidade futura com (a): o payload canônico ganha **byte/prefixo de versão** (`lunex:v2:spot-order\n` inclui o campo `attestation` fora da mensagem assinada pelo usuário). Quando `sr25519_verify` chegar, adiciona-se a verificação da assinatura do maker como **terceira checagem** (defense-in-depth) ou substitui-se a atestação — sem quebrar ordens em voo, porque a versão do payload discrimina os regimes.

O gate `signature_verification_enforced` permanece como kill-switch: passa a ser interpretado como "exigir verificação criptográfica on-chain (atestação)"; o modo `false` continua sendo testnet-only.

## Consequências

**Positivas**
- Settlement desbloqueável em mainnet nesta milestone, sem esperar o chain team.
- Compromisso do relayer deixa de ser suficiente para drenar custódia (P0-1 mitigado a nível de design, não só de gate).
- Caminho de migração limpo para verificação sr25519 nativa (payload versionado).

**Negativas / dívidas**
- Novo serviço de produção (attestor) com chave própria: provisioning, monitoramento, rotação, runbook de incidente.
- Modelo continua não-trustless até (a); deve ser comunicado com transparência (docs de segurança, disclosure para a auditoria externa).
- `SignedOrder`/ABI muda (campo de atestação) → regenerar typechain, atualizar spot-api/SDK/indexer.

**Plano de implementação (resumo para a fase dedicada)**
1. Contrato: campo `attestor_pubkey`, mensagem `set_attestor_key` (owner + evento `AttestorKeyChanged`), `verify_order_signature` v2 com `ecdsa_recover`, payload v2, erros `AttestationInvalid`/`AttestorKeyNotSet`; unit tests com vetores secp256k1 fixos + property tests (fuzz `spot_settlement_replay` atualizado).
2. Backend: serviço attestor isolado (verifica sr25519 com `@polkadot/util-crypto`, assina keccak/blake2 do payload com secp256k1); spot-api anexa atestação ao chamar `settle_trade`.
3. Ops: chaves relayer e attestor em segredos Doppler distintos, hosts/processos distintos; alerta para o evento `SignatureEnforcementChanged` e `AttestorKeyChanged`.
4. Gate: owner habilita settlement (mantendo `enforced == true` na nova semântica) somente após e2e on-chain em testnet com atestação real.

---

## Appendix — Implementação on-chain concluída (2026-06-12)

O lado **on-chain** da opção (c) está implementado em `Lunex/contracts/spot_settlement/lib.rs`. Status: `cargo test -p spot_settlement_contract` 52/52 verde (46 pré-existentes + 6 novos) e `cargo contract build --release` verde. O gate fail-closed `signature_verification_enforced` e o evento `SignatureEnforcementChanged` foram preservados; a semântica do gate agora é "exigir verificação criptográfica on-chain (atestação ECDSA)".

### O que mudou no contrato

| Item | Detalhe |
|---|---|
| Storage | `attestor_pubkey: Option<(u8, [u8; 32])>` — chave secp256k1 comprimida (SEC1, 33 bytes) armazenada como `(tag, x)` porque o `StorageLayout` do ink! 4.x só cobre arrays ≤ 32 bytes. ABI pública continua `[u8; 33]`. Default `None` (fail-closed). |
| Mensagens | `set_attestor_key(pubkey: [u8; 33])` (owner-only, emite `AttestorKeyChanged`) e `get_attestor_key() -> Option<[u8; 33]>`. |
| Evento | `AttestorKeyChanged { attestor_pubkey: [u8; 33], changed_by: AccountId (topic) }` — alerting/indexer DEVE monitorar (rotação de chave é operação privilegiada). |
| ABI `SignedOrder` | Novo campo `attestation: [u8; 65]` — assinatura ECDSA do attestor: `r (32) ‖ s (32) ‖ recovery_id (1, aceita 0/1 ou 27/28)`. **ABI quebra**: regenerar typechain e atualizar spot-api/SDK/indexer. |
| Erro novo | `AttestationInvalid` — `ecdsa_recover` falhou ou pubkey recuperada ≠ `attestor_pubkey`. |
| `verify_order_signature` | Com `enforced == true` (default): sem attestor configurado → `SignatureVerificationUnavailable` (inalterado, fail-closed); com attestor → rejeita sr25519 toda-zero (`InvalidSignature`), calcula `blake2_256(payload_v2)`, `env().ecdsa_recover(&attestation, &hash)` e compara com a chave configurada. Com `enforced == false` (testnet-only): comportamento anterior inalterado. |
| Doc de segurança | Doc comment em `verify_order_signature` deixa explícito: mitigação **interina** 2-de-2 (relayer + attestor), não-trustless, até `sr25519_verify` nativo (EXT-CRYPTO / opção a). |

### Payload canônico v2 (contrato de integração — reproduzir byte a byte)

A mensagem que o attestor assina é `blake2_256(payload_v2)`, onde `payload_v2` é (inteiros little-endian, ordem fixa, sem separadores):

| Offset | Campo | Tamanho | Formato |
|---|---|---|---|
| 0 | prefixo de domínio | 20 | `b"lunex:v2:spot-order\n"` |
| 20 | `maker` | 32 | AccountId bytes crus |
| 52 | `base_token` | 32 | AccountId bytes crus |
| 84 | `quote_token` | 32 | AccountId bytes crus |
| 116 | `side` | 1 | `0` = BUY, `1` = SELL |
| 117 | `price` | 16 | u128 LE |
| 133 | `amount` | 16 | u128 LE |
| 149 | `nonce` | 8 | u64 LE |
| 157 | `expiry` | 8 | u64 LE |
| | **total** | **165** | |

Exclusões deliberadas: `filled_amount` (fill acumulado on-chain é canônico), `signature` e `attestation` (são provas SOBRE o payload). Manter o payload v2 livre da assinatura sr25519 permite que, quando EXT-CRYPTO chegar (opção a), o MESMO hash seja verificado direto contra a assinatura sr25519 do maker, sem nova migração de payload.

Vetores de teste determinísticos: secret key de teste `0x42 × 32` (e rogue `0x24 × 32`) via crate `secp256k1 0.27` (mesma versão/crate que o `ink_engine` usa no `ecdsa_recover` off-chain) — ver helpers `attestor_secret()`/`sign_attestation()` no módulo de testes do contrato. **Nunca usar essas chaves fora de teste.**

### Testes novos (módulo `tests` do contrato)

1. `test_settle_trade_with_valid_attestation_succeeds` — enforcement ON + attestor configurado + atestação real → settle OK, saldos conferidos.
2. `test_settle_trade_attestation_from_wrong_key_fails` — atestação de outra chave → `AttestationInvalid`, estado intocado.
3. `test_settle_trade_tampered_payload_fails` — campo alterado pós-atestação → `AttestationInvalid`.
4. `test_settle_trade_enforced_without_attestor_key_stays_blocked` — sem attestor → `SignatureVerificationUnavailable`.
5. `test_only_owner_sets_attestor_key_and_event_is_emitted` — não-owner `AccessDenied`; owner OK + evento `AttestorKeyChanged` decodificado.
6. `test_enforced_mode_rejects_zero_maker_signature_even_with_attestation` — sr25519 toda-zero rejeitada antes do recover.

### O que o backend precisa implementar em seguida (ordem sugerida)

1. **Attestor service (novo, isolado):** processo/host/segredo próprios (Doppler config distinta do `RELAYER_SEED`); gera/recebe chave secp256k1; expõe endpoint interno `attest(order)` que (a) reconstrói o payload v1 e verifica a assinatura sr25519 do maker com `@polkadot/util-crypto` (mesma verificação já existente em `settlementService.ts`), (b) se válida, monta o payload v2 acima, calcula `blake2AsU8a(payload, 256)` e assina com secp256k1 retornando 65 bytes `r‖s‖recovery_id` (recovery_id 0/1).
2. **spot-api (relayer):** pedir atestação ao attestor para cada ordem matched; anexar `attestation` ao `SignedOrder`; recusar settle se o attestor estiver indisponível (fail-closed off-chain também).
3. **Typechain/ABI:** recompilar o contrato, regenerar bindings (`npm run compile`), atualizar tipos do `SignedOrder` em spot-api, SDK e indexer (campo `attestation: [u8; 65]`).
4. **Admin/deploy:** chamada owner `set_attestor_key(pubkey)` no deploy/rotação; runbook de rotação (gerar nova chave → `set_attestor_key` → trocar segredo do serviço).
5. **Observabilidade:** alertas para eventos `AttestorKeyChanged` e `SignatureEnforcementChanged`; métrica de latência/erro do attestor; alarme para `AttestationInvalid` em settles (indica bug de serialização do payload ou tentativa de forja).
6. **Teste de paridade de payload:** teste TS que reproduz o payload v2 byte a byte e confere o hash blake2-256 contra um vetor fixo gerado pelo teste Rust (garante que contrato e backend nunca divergem na serialização).
7. **E2E testnet:** fluxo completo deposit → order → match → attest → settle on-chain com `enforced == true` antes de habilitar mainnet.
8. **Fuzz (dívida):** atualizar `fuzz/fuzz_targets/spot_settlement_replay.rs` para cobrir o caminho de atestação (hoje não constrói `SignedOrder` diretamente; revisar após regenerar tipos).

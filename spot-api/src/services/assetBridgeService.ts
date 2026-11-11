/**
 * Asset Bridge Service (Security Hardened)
 *
 * Relay-bridge service that monitors pallet-assets transfers to the bridge account
 * and mints PSP22 wrapper tokens. Also monitors WithdrawQueued events from wrapper
 * contracts, confirms the escrow on-chain and sends pallet-assets tokens back.
 *
 * SECURITY FEATURES:
 *   B-01: Uses FINALIZED blocks only (prevents block reorg double-mint)
 *   B-02: Persistent deduplication via file + on-chain deposit_ref
 *   B-03: Sequential nonce management (prevents nonce collision)
 *   B-04: ABI-based event decoding (not raw byte offsets)
 *   B-05: Pre-flight balance check before withdrawal
 *   C-01: Only ABI-decoded WithdrawQueued counts; confirm_withdraw before send
 *   A-07: Every finalized block is processed, in order, cursor-after-success
 *   R1-R4: Ambiguous txs settled by the block stream, nonce resync + timeouts,
 *          proven mints with retry, atomic fail-closed state file
 *
 * Flow:
 *   WRAP:   user -> assets.transfer(bridge) -> relayer detects -> wrapper.mint_with_ref(user, amount, ref)
 *   UNWRAP: user -> wrapper.request_withdraw(amount) -> WithdrawQueued{id} -> relayer
 *           wrapper.confirm_withdraw(id) (burns escrow) -> assets.transfer(owner, amount)
 */

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import type { SubmittableExtrinsic } from '@polkadot/api/types';
import type { DecodedEvent } from '@polkadot/api-contract/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { Enum, Result } from '@polkadot/types';
import type { EventRecord } from '@polkadot/types/interfaces';
import type { Codec, ISubmittableResult } from '@polkadot/types/types';
import { BN } from '@polkadot/util';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { dryRunGasLimit, txGasLimit } from '../utils/contractGas';
import { log } from '../utils/logger';
import {
  isDevSeed,
  isLocalEndpoint,
  isPlaceholder,
} from '../utils/productionGuards';
import { DEFAULT_TX_TIMEOUT_MS, withTxTimeout } from '../utils/txWithTimeout';
import { isSameAccount } from '../utils/validation';

// --- Types ---

interface BridgeAssetConfig {
  assetId: number;
  wrapperAddress: string;
  symbol: string;
  // SEC R8: smallest amount (base units, decimal string) minted automatically;
  // smaller deposits are recorded as MANUAL. Unset: no minimum.
  minDepositAmount?: string;
}

interface BridgeConfig {
  wsEndpoint: string;
  adminSeed: string;
  assets: BridgeAssetConfig[];
  contractMetadataPath: string;
  stateFilePath: string; // SEC B-02: persistent state file
  txTimeoutMs?: number; // bound on every extrinsic (default 60 s)
  // SEC R8: mint/confirm/payout items handled inline per block, and per kind
  // per retry pass; the excess stays PENDING for the retry.
  maxInlinePerBlock?: number;
}

/**
 * SEC C-01 withdrawal lifecycle, keyed "wrapperAddress:withdrawalId". Our own
 * submission settles what it can; the finalized block stream
 * (WithdrawConfirmed / WithdrawReclaimed) settles everything else.
 *
 *   PENDING    -> CONFIRMING  persisted right before confirm_withdraw is broadcast
 *   CONFIRMING -> CONFIRMED   our confirm finalized with WithdrawConfirmed(id),
 *                             or WithdrawConfirmed(id) seen later in the stream
 *   CONFIRMING -> PENDING     confirm finalized but failed (ExtrinsicFailed, or
 *                             ExtrinsicSuccess without WithdrawConfirmed(id));
 *                             a finalized status with neither is ambiguous and
 *                             stays CONFIRMING (SEC R7)
 *   CONFIRMED  -> DONE        pallet-asset delivered
 *   PENDING    -> CONFIRMED   WithdrawConfirmed(id) we never broadcast: NOT sent
 *   PENDING | CONFIRMING -> RECLAIMED  WithdrawReclaimed(id) seen
 *
 * CONFIRMING is never re-broadcast and CONFIRMED is never re-sent: both wait
 * for the stream or an operator. Only PENDING is retried.
 */
type WithdrawalStatus =
  | 'PENDING'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'DONE'
  | 'RECLAIMED';

type WithdrawalRecord = {
  status: WithdrawalStatus;
  assetId: number;
  wrapperAddress: string;
  withdrawalId: string;
  owner: string;
  amount: string;
  blockNumber: number;
  lastAttemptBlock: number;
  lastError?: string;
};

/**
 * SEC R3: a deposit stays PENDING until the wrapper emitted Mint with its
 * deposit_ref. Retrying is safe: the contract rejects a reused ref with
 * DepositAlreadyProcessed, which marks the record DONE.
 *
 * MANUAL is a quarantine: the deposit is recorded (lastError says why) but is
 * never minted or retried automatically; an operator settles it. Used when
 * the event index does not fit deposit_ref (depositRef null) and for amounts
 * below the asset's minDepositAmount.
 */
type DepositRecord = {
  status: 'PENDING' | 'DONE' | 'MANUAL';
  assetId: number;
  wrapperAddress: string;
  from: string;
  amount: string;
  blockNumber: number;
  depositRef: number | null;
  lastAttemptBlock: number;
  lastError?: string;
};

interface BridgeState {
  lastProcessedBlock: number;
  // Legacy, read-only: "blockNum:extrinsicIdx" -> true, written by the old relayer
  processedDeposits: Record<string, boolean>;
  deposits: Record<string, DepositRecord>; // "blockNum:eventIdx"
  withdrawals: Record<string, WithdrawalRecord>; // "wrapperAddress:withdrawalId"
}

/** Finalized blocks between two automatic attempts on one PENDING record. */
const RETRY_INTERVAL_BLOCKS = 10;

/** deposit_ref = blockNumber * DEPOSIT_REF_STRIDE + index of the event in the block. */
const DEPOSIT_REF_STRIDE = 10_000;

/** Default SEC R8 bound on inline mint/confirm/payout items per block. */
const DEFAULT_MAX_INLINE_PER_BLOCK = 20;

/** Slack on top of the in-flight item's tx timeouts that stop() waits for. */
const STOP_WAIT_SLACK_MS = 5_000;

const DEFERRED_ERROR =
  'deferred: per-block inline limit reached or stopping, left PENDING for the retry';

type ContractApi = ConstructorParameters<typeof ContractPromise>[0];

function asContractApi(api: ApiPromise): ContractApi {
  return api as unknown as ContractApi;
}

function emptyState(): BridgeState {
  return {
    lastProcessedBlock: 0,
    processedDeposits: {},
    deposits: {},
    withdrawals: {},
  };
}

// --- Service ---

export class AssetBridgeService {
  private api!: ApiPromise;
  private adminAccount!: KeyringPair;
  private wrapperContracts: Map<number, ContractPromise> = new Map();
  private running = false;
  private unsubscribeBlocks?: () => void;
  private state: BridgeState = emptyState();
  private currentNonce: number = -1; // SEC B-03: sequential nonce
  private nonceStale = false; // SEC R2: resync from chain before next extrinsic
  private latestFinalizedHead = 0; // SEC A-07: highest finalized head seen
  private catchingUp = false; // SEC A-07: one block-processing loop at a time
  private currentRun?: Promise<void>; // the loop stop() waits for
  private lastRetryBlock = -1; // SEC R8: cursor at the last retry pass
  private inlineBudget = 0; // SEC R8: items left for the block in progress

  constructor(private config: BridgeConfig) {
    const keyring = new Keyring({ type: 'sr25519' });
    this.adminAccount = keyring.addFromUri(config.adminSeed);
  }

  get bridgeAddress(): string {
    return this.adminAccount.address;
  }

  // --- State Persistence (SEC B-02, R4) ---

  /**
   * A missing file is a fresh start. An existing file that cannot be read or
   * parsed is fatal: the state decides what gets paid, so guessing is unsafe.
   */
  private loadState(): BridgeState {
    const file = this.config.stateFilePath;
    if (!fs.existsSync(file)) return emptyState();

    let parsed: Partial<BridgeState>;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('not a JSON object');
      }
    } catch (err) {
      throw new Error(
        `Bridge state file ${file} is unreadable or corrupt, refusing to start: ${errorMessage(err)}`,
      );
    }
    return {
      lastProcessedBlock: parsed.lastProcessedBlock ?? 0,
      processedDeposits: parsed.processedDeposits ?? {},
      deposits: parsed.deposits ?? {},
      withdrawals: parsed.withdrawals ?? {},
    };
  }

  /**
   * Atomic write: temp file in the same directory, fsync, rename over the
   * target. Throws, so no caller proceeds past an unsaved transition.
   */
  private saveState(): void {
    const target = this.config.stateFilePath;
    const tmp = `${target}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(this.state, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    log.info('[AssetBridge] Starting bridge service...');

    this.state = this.loadState(); // SEC R4: refuse a corrupt state file

    const provider = new WsProvider(this.config.wsEndpoint);
    this.api = await ApiPromise.create({ provider });
    await this.api.isReady;
    log.info(`[AssetBridge] Connected. Bridge account: ${this.bridgeAddress}`);

    // Load contract metadata
    const metadataPath = path.resolve(this.config.contractMetadataPath);
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Contract metadata not found: ${metadataPath}`);
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    // Initialize wrapper contracts
    for (const asset of this.config.assets) {
      if (
        asset.minDepositAmount !== undefined &&
        !/^\d+$/.test(asset.minDepositAmount)
      ) {
        throw new Error(
          `Invalid minDepositAmount for asset #${asset.assetId}: expected a decimal integer string`,
        );
      }
      const contract = new ContractPromise(
        asContractApi(this.api),
        metadata,
        asset.wrapperAddress,
      );
      // SEC C-01: refuse a wrapper ABI that predates the withdrawal escrow;
      // with ink 4 index-based events it would silently mis-decode.
      const events = new Set(contract.abi.events.map((e) => e.identifier));
      const messages = new Set(contract.abi.messages.map((m) => m.method));
      const hasEscrowAbi =
        [
          'WithdrawQueued',
          'WithdrawConfirmed',
          'WithdrawReclaimed',
          'Mint',
        ].every((name) => events.has(name)) &&
        messages.has('confirmWithdraw') &&
        messages.has('mintWithRef');
      if (!hasEscrowAbi) {
        throw new Error(
          `Wrapper metadata ${metadataPath} lacks WithdrawQueued/WithdrawConfirmed/WithdrawReclaimed/Mint events or confirm_withdraw/mint_with_ref messages (stale ABI)`,
        );
      }
      this.wrapperContracts.set(asset.assetId, contract);
      log.info(
        `[AssetBridge] Registered ${asset.symbol} (asset #${asset.assetId}) -> ${asset.wrapperAddress}`,
      );
    }

    // SEC B-03: Initialize nonce from chain
    const nonce = await this.api.rpc.system.accountNextIndex(
      this.adminAccount.address,
    );
    this.currentNonce = nonce.toNumber();
    log.info(`[AssetBridge] Starting nonce: ${this.currentNonce}`);

    this.running = true;

    // SEC B-01: Subscribe to FINALIZED heads only (prevents block reorg attacks)
    this.unsubscribeBlocks = (await this.api.rpc.chain.subscribeFinalizedHeads(
      async (header) => {
        await this.onFinalizedHead(header.number.toNumber());
      },
    )) as unknown as () => void;

    log.info(
      `[AssetBridge] Listening for FINALIZED deposit/withdraw events (from block ${
        this.state.lastProcessedBlock + 1
      })...`,
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.unsubscribeBlocks) {
      this.unsubscribeBlocks();
    }
    await this.waitForCurrentRun();
    try {
      this.saveState();
    } catch (err) {
      log.error(
        { err },
        '[AssetBridge] CRITICAL: Failed to save state on stop',
      );
    }
    if (this.api) {
      await this.api.disconnect();
    }
    log.info('[AssetBridge] Stopped.');
  }

  /**
   * SEC R9: with `running` false no new item starts, so the run in progress
   * ends after its current item, at worst a confirm_withdraw followed by its
   * payout (two tx timeouts). Wait for that, bounded, so a shutdown does not
   * strand a record in CONFIRMING / CONFIRMED with the outcome unrecorded.
   */
  private async waitForCurrentRun(): Promise<void> {
    const run = this.currentRun;
    if (!run) return;
    const txTimeoutMs = this.config.txTimeoutMs ?? DEFAULT_TX_TIMEOUT_MS;
    const capMs = 2 * txTimeoutMs + STOP_WAIT_SLACK_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      run.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), capMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (!finished) {
      log.error(
        { capMs },
        '[AssetBridge] CRITICAL: In-flight bridge work did not finish before the stop deadline; stopping anyway',
      );
    }
  }

  // --- Block Processing (SEC A-07) ---

  /** SEC R8: configured per-block inline bound, invalid values -> default. */
  private get maxInlinePerBlock(): number {
    const configured = this.config.maxInlinePerBlock;
    return configured !== undefined &&
      Number.isInteger(configured) &&
      configured >= 1
      ? configured
      : DEFAULT_MAX_INLINE_PER_BLOCK;
  }

  /**
   * SEC R8: claim one inline mint/confirm for the block in progress. False
   * once the block's budget is spent or the service is stopping; the caller
   * then leaves the record PENDING for the retry.
   */
  private takeInlineSlot(): boolean {
    if (!this.running || this.inlineBudget <= 0) return false;
    this.inlineBudget--;
    return true;
  }

  /**
   * Process every block from `lastProcessedBlock + 1` up to the newest
   * finalized head, in order. The persisted cursor only advances after a block
   * succeeds (including its state save); on error we stop and retry that block
   * on the next head. Heads that arrive mid-run only raise the target of the
   * run already in progress, so a block is never processed by two loops. Due
   * PENDING records are retried every RETRY_INTERVAL_BLOCKS blocks while
   * catching up, and once caught up.
   */
  private async onFinalizedHead(headNumber: number): Promise<void> {
    if (!this.running) return;
    this.latestFinalizedHead = Math.max(this.latestFinalizedHead, headNumber);
    if (this.catchingUp) return;

    if (this.state.lastProcessedBlock === 0) {
      // No persisted cursor: keep the previous behaviour of starting at the
      // current head instead of replaying the chain from genesis.
      this.state.lastProcessedBlock = headNumber - 1;
      log.warn(
        { headNumber },
        '[AssetBridge] No persisted cursor, starting at current finalized head',
      );
    }

    this.catchingUp = true;
    const run = this.catchUp();
    this.currentRun = run;
    try {
      await run;
    } finally {
      this.currentRun = undefined;
      this.catchingUp = false;
    }
  }

  private async catchUp(): Promise<void> {
    if (this.lastRetryBlock < 0) {
      this.lastRetryBlock = this.state.lastProcessedBlock;
    }
    while (
      this.running &&
      this.state.lastProcessedBlock < this.latestFinalizedHead
    ) {
      const blockNumber = this.state.lastProcessedBlock + 1;
      try {
        await this.processBlock(blockNumber);
        this.state.lastProcessedBlock = blockNumber;
        this.saveState();
      } catch (err) {
        this.state.lastProcessedBlock = blockNumber - 1;
        log.error(
          { err, blockNumber },
          '[AssetBridge] Error processing block, will retry on next finalized head',
        );
        return;
      }
      // SEC R8: a relayer that is behind still serves PENDING records.
      if (blockNumber - this.lastRetryBlock >= RETRY_INTERVAL_BLOCKS) {
        await this.retryPending();
      }
    }
    await this.retryPending();
  }

  private async processBlock(blockNumber: number): Promise<void> {
    this.inlineBudget = this.maxInlinePerBlock;
    const blockHash = await this.api.rpc.chain.getBlockHash(blockNumber);
    const events = (await this.api.query.system.events.at(
      blockHash,
    )) as unknown as EventRecord[];

    await this.processDeposits(events, blockNumber);
    await this.processWithdrawals(events, blockNumber);
  }

  /**
   * SEC R1/R3: retry PENDING deposits and withdrawals at most once every
   * RETRY_INTERVAL_BLOCKS finalized blocks each. CONFIRMING / CONFIRMED /
   * MANUAL are never retried here. SEC R8: at most maxInlinePerBlock attempts
   * per kind and pass, so a flood of deposits cannot starve withdrawals.
   */
  private async retryPending(): Promise<void> {
    const now = this.state.lastProcessedBlock;
    this.lastRetryBlock = now;
    const limit = this.maxInlinePerBlock;
    const isDue = (record: { status: string; lastAttemptBlock: number }) =>
      record.status === 'PENDING' &&
      now - record.lastAttemptBlock >= RETRY_INTERVAL_BLOCKS;
    try {
      let attempts = 0;
      for (const [key, deposit] of Object.entries(this.state.deposits)) {
        if (!this.running || attempts >= limit) break;
        if (isDue(deposit)) {
          attempts++;
          await this.attemptMint(key, deposit, now);
        }
      }
      attempts = 0;
      for (const [key, withdrawal] of Object.entries(this.state.withdrawals)) {
        if (!this.running || attempts >= limit) break;
        if (isDue(withdrawal)) {
          attempts++;
          await this.attemptConfirm(key, withdrawal, now);
        }
      }
    } catch (err) {
      log.error({ err }, '[AssetBridge] Retry of pending records aborted');
    }
  }

  // --- Deposit Processing (SEC R3) ---

  private async processDeposits(
    events: EventRecord[],
    blockNumber: number,
  ): Promise<void> {
    for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
      const { event, phase } = events[eventIndex];
      if (event.section !== 'assets' || event.method !== 'Transferred')
        continue;

      const [assetId, from, to, amount] = event.data;
      // SEC R5: compare account ids; the chain and the keyring may use
      // different SS58 prefixes (Lunes mainnet 57, keyring default 42).
      if (!isSameAccount(to.toString(), this.bridgeAddress)) continue;

      const assetIdNum = Number(assetId.toString());
      const asset = this.config.assets.find((a) => a.assetId === assetIdNum);
      if (!asset || !this.wrapperContracts.has(assetIdNum)) {
        log.warn(
          `[AssetBridge] Received asset #${assetIdNum} but no wrapper configured`,
        );
        continue;
      }
      // Legacy dedup (old relayer keyed deposits by extrinsic index).
      const extrinsicIndex = phase.isApplyExtrinsic
        ? phase.asApplyExtrinsic.toNumber()
        : eventIndex;
      if (this.state.processedDeposits[`${blockNumber}:${extrinsicIndex}`]) {
        log.info(
          `[AssetBridge] Skipping deposit ${blockNumber}:${extrinsicIndex} recorded by the legacy relayer`,
        );
        continue;
      }

      const key = `${blockNumber}:${eventIndex}`;
      const existing = this.state.deposits[key];
      if (existing?.status === 'DONE') {
        log.info(`[AssetBridge] Skipping already minted deposit ${key}`);
        continue;
      }
      if (existing?.status === 'MANUAL') {
        log.warn(
          { key, lastError: existing.lastError },
          '[AssetBridge] Skipping quarantined deposit (MANUAL), not minting',
        );
        continue;
      }

      const amountStr = amount.toString();
      const fitsRef = eventIndex < DEPOSIT_REF_STRIDE;
      const depositRef = fitsRef
        ? blockNumber * DEPOSIT_REF_STRIDE + eventIndex
        : null;

      if (!existing) {
        // SEC R6/R8: record and quarantine instead of minting; never throw,
        // or one deposit would stall the cursor on this block forever.
        const quarantine = depositQuarantineReason(
          asset,
          eventIndex,
          amountStr,
        );
        if (quarantine) {
          this.state.deposits[key] = {
            status: 'MANUAL',
            assetId: assetIdNum,
            wrapperAddress: asset.wrapperAddress,
            from: from.toString(),
            amount: amountStr,
            blockNumber,
            depositRef,
            lastAttemptBlock: blockNumber,
            lastError: quarantine,
          };
          this.saveState();
          if (fitsRef) {
            log.warn(
              { key, reason: quarantine },
              '[AssetBridge] Deposit below minimum recorded as MANUAL, not minted',
            );
          } else {
            log.error(
              { key, reason: quarantine },
              '[AssetBridge] CRITICAL: Deposit quarantined (MANUAL), not minted; manual resolution required',
            );
          }
          continue;
        }
      }

      const deposit: DepositRecord = existing ?? {
        status: 'PENDING',
        assetId: assetIdNum,
        wrapperAddress: asset.wrapperAddress,
        from: from.toString(),
        amount: amountStr,
        blockNumber,
        depositRef,
        lastAttemptBlock: blockNumber,
      };
      const inline = this.takeInlineSlot();
      if (!inline) {
        // Due on the next retry pass; persisted before the cursor advances.
        deposit.lastAttemptBlock = blockNumber - RETRY_INTERVAL_BLOCKS;
        deposit.lastError = DEFERRED_ERROR;
      }
      this.state.deposits[key] = deposit;
      this.saveState();

      if (inline) {
        await this.attemptMint(key, deposit, blockNumber);
      } else {
        log.warn({ key }, `[AssetBridge] Mint ${DEFERRED_ERROR}`);
      }
    }
  }

  /**
   * Dry-run mint_with_ref, submit it, and mark the deposit DONE only when the
   * finalized extrinsic emitted Mint with this deposit_ref (or the dry-run
   * says the ref was already minted). Anything else leaves it PENDING.
   */
  private async attemptMint(
    key: string,
    deposit: DepositRecord,
    now: number,
  ): Promise<void> {
    const ref = deposit.depositRef;
    // MANUAL / DONE records and refless deposits are never minted here.
    if (deposit.status !== 'PENDING' || ref === null) return;
    deposit.lastAttemptBlock = now;
    const label = `mint_with_ref(ref ${ref})`;
    try {
      const contract = this.wrapperContracts.get(deposit.assetId);
      if (!contract)
        throw new Error(`No wrapper for asset #${deposit.assetId}`);

      const dryRun = await contract.query.mintWithRef(
        this.bridgeAddress,
        { gasLimit: dryRunGasLimit(this.api), storageDepositLimit: null },
        deposit.from,
        new BN(deposit.amount),
        ref,
      );
      if (dryRun.result.isErr) throw new Error(`${label} dry-run failed`);
      if (dryRun.result.asOk.flags.isRevert) {
        const reason = wrapperErrorOf(dryRun.output);
        if (reason === 'DepositAlreadyProcessed') {
          deposit.status = 'DONE';
          delete deposit.lastError;
          this.saveState();
          log.info(`[AssetBridge] Deposit ${key} (ref ${ref}) already minted`);
          return;
        }
        throw new Error(`${label} dry-run reverted: ${reason ?? 'unknown'}`);
      }

      const tx = contract.tx.mintWithRef(
        {
          gasLimit: txGasLimit(this.api, dryRun.gasRequired),
          storageDepositLimit: null,
        },
        deposit.from,
        new BN(deposit.amount),
        ref,
      );
      const events = await this.submit(label, tx);
      if (hasExtrinsicFailed(events))
        throw new Error(`${label}: ExtrinsicFailed`);
      if (
        !this.hasWrapperEvent(
          contract,
          deposit.wrapperAddress,
          events,
          'Mint',
          {
            name: 'depositRef',
            value: String(ref),
          },
        )
      ) {
        throw new Error(`${label}: no Mint event with this ref`);
      }
    } catch (err) {
      deposit.lastError = errorMessage(err);
      this.saveState();
      log.error(
        { err, key },
        '[AssetBridge] CRITICAL: Mint not confirmed, deposit left PENDING for retry',
      );
      return;
    }

    deposit.status = 'DONE';
    delete deposit.lastError;
    this.saveState();
    log.info(
      `[AssetBridge] Minted ${deposit.amount} wrapper tokens to ${deposit.from} (ref ${ref})`,
    );
  }

  // --- Withdrawal Processing (SEC C-01, R1) ---

  /**
   * Only wrapper events decoded with its ABI count. WithdrawQueued opens a
   * withdrawal; WithdrawConfirmed / WithdrawReclaimed settle it. The assetId
   * comes from the emitting wrapper's config, never from event bytes.
   */
  private async processWithdrawals(
    events: EventRecord[],
    blockNumber: number,
  ): Promise<void> {
    for (const record of events) {
      const { event } = record;
      if (event.section !== 'contracts' || event.method !== 'ContractEmitted')
        continue;

      const contractAddr = event.data[0].toString();
      const matchedAsset = this.config.assets.find((asset) =>
        isSameAccount(asset.wrapperAddress, contractAddr),
      );
      if (!matchedAsset) continue;
      const contract = this.wrapperContracts.get(matchedAsset.assetId);
      if (!contract) continue;

      let decoded: DecodedEvent;
      try {
        decoded = contract.abi.decodeEvent(record);
      } catch (err) {
        log.warn(
          { err, contractAddr, blockNumber },
          '[AssetBridge] Undecodable wrapper event, ignoring',
        );
        continue;
      }

      const name = decoded.event.identifier;
      if (
        name !== 'WithdrawQueued' &&
        name !== 'WithdrawConfirmed' &&
        name !== 'WithdrawReclaimed'
      )
        continue;

      const withdrawalId = this.eventArg(decoded, 'id').toString();
      const key = `${matchedAsset.wrapperAddress}:${withdrawalId}`;
      if (name === 'WithdrawQueued') {
        await this.onWithdrawQueued(key, decoded, matchedAsset, blockNumber);
      } else if (name === 'WithdrawConfirmed') {
        await this.onWithdrawConfirmed(key);
      } else {
        this.onWithdrawReclaimed(key);
      }
    }
  }

  private async onWithdrawQueued(
    key: string,
    decoded: DecodedEvent,
    asset: BridgeAssetConfig,
    blockNumber: number,
  ): Promise<void> {
    const existing = this.state.withdrawals[key];
    switch (existing?.status) {
      case 'DONE':
      case 'RECLAIMED':
        log.info(`[AssetBridge] Skipping settled withdrawal ${key}`);
        return;
      case 'CONFIRMING':
        log.warn(
          { key },
          '[AssetBridge] confirm_withdraw already broadcast; waiting for WithdrawConfirmed/WithdrawReclaimed, not re-broadcasting',
        );
        return;
      case 'CONFIRMED':
        log.error(
          { key, lastError: existing.lastError },
          '[AssetBridge] CRITICAL: Withdrawal escrow burned but delivery not recorded; NOT resending, manual resolution required',
        );
        return;
    }

    const withdrawal: WithdrawalRecord = existing ?? {
      status: 'PENDING',
      assetId: asset.assetId,
      wrapperAddress: asset.wrapperAddress,
      withdrawalId: this.eventArg(decoded, 'id').toString(),
      owner: this.eventArg(decoded, 'owner').toString(),
      amount: this.eventArg(decoded, 'amount').toString(),
      blockNumber,
      lastAttemptBlock: blockNumber,
    };
    const inline = this.takeInlineSlot();
    if (!inline) {
      // Due on the next retry pass; persisted before the cursor advances.
      withdrawal.lastAttemptBlock = blockNumber - RETRY_INTERVAL_BLOCKS;
      withdrawal.lastError = DEFERRED_ERROR;
    }
    this.state.withdrawals[key] = withdrawal;
    this.saveState();

    if (inline) {
      await this.attemptConfirm(key, withdrawal, blockNumber);
    } else {
      log.warn({ key }, `[AssetBridge] confirm_withdraw ${DEFERRED_ERROR}`);
    }
  }

  private async onWithdrawConfirmed(key: string): Promise<void> {
    const withdrawal = this.state.withdrawals[key];
    if (!withdrawal) {
      log.error(
        { key },
        '[AssetBridge] CRITICAL: WithdrawConfirmed for unknown withdrawal (escrow burned, no local record); NOT sending, manual resolution required',
      );
      return;
    }
    if (withdrawal.status === 'CONFIRMING') {
      // Our own confirm landed after we stopped waiting for it. The payout
      // counts against the block's inline budget but is never deferred:
      // CONFIRMING / CONFIRMED have no retry path.
      withdrawal.status = 'CONFIRMED';
      delete withdrawal.lastError;
      this.saveState();
      this.inlineBudget = Math.max(0, this.inlineBudget - 1);
      await this.sendWithdrawal(key, withdrawal);
      return;
    }
    if (withdrawal.status === 'PENDING') {
      withdrawal.status = 'CONFIRMED';
      withdrawal.lastError =
        'Confirmed on-chain externally (this relayer had no confirm in flight); NOT sent';
      this.saveState();
      log.error(
        { key },
        '[AssetBridge] CRITICAL: Withdrawal confirmed externally; NOT sending, manual resolution required',
      );
    }
    // CONFIRMED / DONE / RECLAIMED: already settled, never a second send.
  }

  private onWithdrawReclaimed(key: string): void {
    const withdrawal = this.state.withdrawals[key];
    if (!withdrawal) {
      log.warn(
        { key },
        '[AssetBridge] WithdrawReclaimed for unknown withdrawal',
      );
      return;
    }
    if (withdrawal.status === 'PENDING' || withdrawal.status === 'CONFIRMING') {
      withdrawal.status = 'RECLAIMED';
      this.saveState();
      log.info(`[AssetBridge] Withdrawal ${key} reclaimed by its owner`);
    }
  }

  /**
   * PENDING -> CONFIRMING -> (finalized) CONFIRMED -> send. A dry-run revert,
   * missing balance or RPC error before the broadcast leaves it PENDING. After
   * the broadcast attempt only a finalized, definitive failure returns it to
   * PENDING; a timeout / drop / rejection leaves it CONFIRMING for the stream.
   */
  private async attemptConfirm(
    key: string,
    withdrawal: WithdrawalRecord,
    now: number,
  ): Promise<void> {
    withdrawal.lastAttemptBlock = now;
    const label = `confirm_withdraw(${key})`;
    const amount = new BN(withdrawal.amount);

    let contract: ContractPromise;
    let tx: SubmittableExtrinsic<'promise'>;
    try {
      const found = this.wrapperContracts.get(withdrawal.assetId);
      if (!found)
        throw new Error(`No wrapper for asset #${withdrawal.assetId}`);
      contract = found;

      // SEC B-05: do not burn the escrow if we cannot deliver; the owner can
      // still reclaim it after the deadline.
      const bridgeBalance = await this.checkAssetBalance(
        withdrawal.assetId,
        this.bridgeAddress,
      );
      if (bridgeBalance.lt(amount)) {
        throw new Error(
          `Insufficient bridge balance: has ${bridgeBalance}, needs ${amount}`,
        );
      }

      const dryRun = await contract.query.confirmWithdraw(
        this.bridgeAddress,
        { gasLimit: dryRunGasLimit(this.api), storageDepositLimit: null },
        withdrawal.withdrawalId,
      );
      if (dryRun.result.isErr || dryRun.result.asOk.flags.isRevert) {
        throw new Error(
          `${label} dry-run reverted: ${wrapperErrorOf(dryRun.output) ?? 'dispatch error'}`,
        );
      }
      tx = contract.tx.confirmWithdraw(
        {
          gasLimit: txGasLimit(this.api, dryRun.gasRequired),
          storageDepositLimit: null,
        },
        withdrawal.withdrawalId,
      );
    } catch (err) {
      withdrawal.lastError = errorMessage(err);
      this.saveState();
      log.error(
        { err, key },
        '[AssetBridge] confirm_withdraw not broadcast; withdrawal left PENDING',
      );
      return;
    }

    withdrawal.status = 'CONFIRMING';
    delete withdrawal.lastError;
    try {
      this.saveState();
    } catch (err) {
      withdrawal.status = 'PENDING';
      throw err; // never broadcast without CONFIRMING on disk
    }

    let events: EventRecord[];
    try {
      events = await this.submit(label, tx);
    } catch (err) {
      withdrawal.lastError = `${errorMessage(err)}; outcome unknown, awaiting WithdrawConfirmed/WithdrawReclaimed`;
      this.saveState();
      log.error(
        { err, key },
        '[AssetBridge] CRITICAL: confirm_withdraw outcome unknown; left CONFIRMING, the block stream decides',
      );
      return;
    }

    const confirmed =
      !hasExtrinsicFailed(events) &&
      this.hasWrapperEvent(
        contract,
        withdrawal.wrapperAddress,
        events,
        'WithdrawConfirmed',
        { name: 'id', value: withdrawal.withdrawalId },
      );
    if (!confirmed) {
      withdrawal.status = 'PENDING';
      withdrawal.lastError = hasExtrinsicFailed(events)
        ? `${label}: ExtrinsicFailed`
        : `${label}: no WithdrawConfirmed event`;
      this.saveState();
      log.error(
        { key, lastError: withdrawal.lastError },
        '[AssetBridge] confirm_withdraw failed on-chain, NOT sending; withdrawal back to PENDING',
      );
      return;
    }

    withdrawal.status = 'CONFIRMED';
    this.saveState();
    await this.sendWithdrawal(key, withdrawal);
  }

  /** CONFIRMED -> DONE. Any failure or ambiguity stays CONFIRMED, never resent. */
  private async sendWithdrawal(
    key: string,
    withdrawal: WithdrawalRecord,
  ): Promise<void> {
    const amount = new BN(withdrawal.amount);
    const label = `assets.transfer(${key})`;
    try {
      const events = await this.submit(
        label,
        this.api.tx.assets.transfer(
          withdrawal.assetId,
          withdrawal.owner,
          amount,
        ),
      );
      if (hasExtrinsicFailed(events))
        throw new Error(`${label}: ExtrinsicFailed`);
      if (!hasExtrinsicSuccess(events))
        throw new Error(`${label}: no ExtrinsicSuccess, outcome ambiguous`);
    } catch (err) {
      withdrawal.lastError = errorMessage(err);
      this.saveState();
      log.error(
        { err, key },
        '[AssetBridge] CRITICAL: Escrow burned but delivery failed or unknown; left CONFIRMED for manual resolution',
      );
      return;
    }

    withdrawal.status = 'DONE';
    delete withdrawal.lastError;
    this.saveState();
    log.info(
      `[AssetBridge] Sent ${amount} of asset #${withdrawal.assetId} to ${withdrawal.owner} (${key})`,
    );
  }

  private eventArg(decoded: DecodedEvent, name: string): Codec {
    const index = decoded.event.args.findIndex((arg) => arg.name === name);
    if (index < 0) {
      throw new Error(
        `Wrapper event ${decoded.event.identifier} has no '${name}' field`,
      );
    }
    return decoded.args[index];
  }

  /** True when `events` holds wrapper event `identifier` whose `arg` matches. */
  private hasWrapperEvent(
    contract: ContractPromise,
    wrapperAddress: string,
    events: EventRecord[],
    identifier: string,
    arg: { name: string; value: string },
  ): boolean {
    return events.some((record) => {
      const { event } = record;
      if (event.section !== 'contracts' || event.method !== 'ContractEmitted')
        return false;
      if (!isSameAccount(event.data[0].toString(), wrapperAddress))
        return false;
      try {
        const decoded = contract.abi.decodeEvent(record);
        return (
          decoded.event.identifier === identifier &&
          this.eventArg(decoded, arg.name).toString() === arg.value
        );
      } catch {
        return false;
      }
    });
  }

  // --- On-Chain Operations ---

  /**
   * SEC B-05: Check pallet-asset balance of an account
   */
  private async checkAssetBalance(
    assetId: number,
    account: string,
  ): Promise<BN> {
    try {
      const balance = (await (this.api.query as any).assets.account(
        assetId,
        account,
      )) as any;
      if (balance.isNone) return new BN(0);
      return balance.unwrap().balance.toBn();
    } catch {
      return new BN(0);
    }
  }

  /**
   * SEC B-03/R2: sign and send with the next sequential nonce, bounded by
   * withTxTimeout, resolving with the events of the FINALIZED block. Any
   * rejection (drop/invalid/usurp, submission error, timeout) marks the nonce
   * stale so the next extrinsic resyncs it from the chain. A rejection is NOT
   * proof the extrinsic failed (see txWithTimeout): callers treat it as
   * ambiguous. SEC R7: so is a finalized status whose events could not be
   * fetched (`internalError`) or hold neither system.ExtrinsicSuccess nor
   * system.ExtrinsicFailed (@polkadot/api then reports `events = []`).
   */
  private async submit(
    label: string,
    tx: SubmittableExtrinsic<'promise'>,
  ): Promise<EventRecord[]> {
    if (this.nonceStale) {
      const next = await this.api.rpc.system.accountNextIndex(
        this.bridgeAddress,
      );
      this.currentNonce = next.toNumber();
      this.nonceStale = false;
      log.warn(
        { nonce: this.currentNonce },
        '[AssetBridge] Nonce resynced from chain',
      );
    }
    const nonce = this.currentNonce++;

    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finalized = new Promise<EventRecord[]>((resolve, reject) => {
      tx.signAndSend(
        this.adminAccount,
        { nonce },
        (result: ISubmittableResult) => {
          if (result.isError) {
            reject(new Error(`${label}: dropped, invalid or usurped`));
          } else if (result.status.isFinalized) {
            if (result.internalError) {
              reject(
                new Error(
                  `${label}: finalized but outcome ambiguous: ${result.internalError.message}`,
                ),
              );
            } else if (
              !hasExtrinsicSuccess(result.events) &&
              !hasExtrinsicFailed(result.events)
            ) {
              reject(
                new Error(
                  `${label}: finalized but outcome ambiguous: no ExtrinsicSuccess/ExtrinsicFailed`,
                ),
              );
            } else {
              resolve(result.events);
            }
          }
        },
      )
        .then((unsub) => {
          if (settled) unsub();
          else unsubscribe = unsub;
        })
        .catch(reject);
    });

    try {
      return await withTxTimeout(label, finalized, this.config.txTimeoutMs);
    } catch (err) {
      this.nonceStale = true;
      throw err;
    } finally {
      settled = true;
      unsubscribe?.();
    }
  }
}

/**
 * Why a new deposit must be recorded as MANUAL instead of minted, if at all:
 * its event index does not fit deposit_ref, or it is below the asset minimum.
 */
function depositQuarantineReason(
  asset: BridgeAssetConfig,
  eventIndex: number,
  amount: string,
): string | undefined {
  if (eventIndex >= DEPOSIT_REF_STRIDE) {
    return `event index ${eventIndex} does not fit deposit_ref (stride ${DEPOSIT_REF_STRIDE}); not minted to avoid a ref collision`;
  }
  if (
    asset.minDepositAmount !== undefined &&
    new BN(amount).lt(new BN(asset.minDepositAmount))
  ) {
    return `amount ${amount} is below the minimum deposit ${asset.minDepositAmount}; not minted automatically`;
  }
  return undefined;
}

function hasExtrinsicFailed(events: EventRecord[]): boolean {
  return events.some(
    ({ event }) =>
      event.section === 'system' && event.method === 'ExtrinsicFailed',
  );
}

function hasExtrinsicSuccess(events: EventRecord[]): boolean {
  return events.some(
    ({ event }) =>
      event.section === 'system' && event.method === 'ExtrinsicSuccess',
  );
}

/**
 * Variant name of the contract error in an ink 4 message output
 * `Result<Result<T, WrapperError>, LangError>` that is `Ok(Err(e))`, decoded
 * by @polkadot/api-contract even when the dry-run reverted.
 */
function wrapperErrorOf(output: Codec | null): string | undefined {
  if (!output) return undefined;
  const outer = output as Result<Codec, Codec>;
  if (!outer.isOk) return undefined;
  const inner = outer.asOk as Result<Codec, Enum>;
  if (!inner.isErr) return undefined;
  return inner.asErr.type;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Standalone Runner ---

function assertBridgeConfigSafeForStartup(input: {
  isProd: boolean;
  wsEndpoint: string;
  adminSeed: string;
}) {
  if (!input.adminSeed) {
    throw new Error('BRIDGE_ADMIN_SEED is required for asset bridge startup');
  }

  if (isDevSeed(input.adminSeed)) {
    throw new Error(
      'BRIDGE_ADMIN_SEED must not use a development account for asset bridge startup',
    );
  }

  if (isPlaceholder(input.adminSeed)) {
    throw new Error(
      'BRIDGE_ADMIN_SEED still contains a placeholder value for asset bridge startup',
    );
  }

  if (input.isProd) {
    if (!input.wsEndpoint) {
      throw new Error('LUNES_WS_URL is required for asset bridge startup');
    }

    if (isLocalEndpoint(input.wsEndpoint)) {
      throw new Error(
        'LUNES_WS_URL must not point to localhost for asset bridge startup',
      );
    }
  }
}

export function createBridgeFromEnv(): AssetBridgeService {
  const wsEndpoint = config.blockchain.wsUrl;
  const adminSeed = config.bridge.adminSeed;
  const assetsJson = process.env.BRIDGE_ASSETS || '[]';
  const metadataPath =
    process.env.BRIDGE_CONTRACT_METADATA ||
    './artifacts/asset_wrapper_contract.json';
  const stateFilePath = process.env.BRIDGE_STATE_FILE || './bridge-state.json';
  const maxInlineRaw = process.env.BRIDGE_MAX_INLINE_PER_BLOCK;
  const maxInlinePerBlock =
    maxInlineRaw !== undefined && maxInlineRaw !== ''
      ? Number(maxInlineRaw)
      : undefined;
  if (
    maxInlinePerBlock !== undefined &&
    !(Number.isInteger(maxInlinePerBlock) && maxInlinePerBlock >= 1)
  ) {
    log.warn(
      { maxInlineRaw },
      `[AssetBridge] Invalid BRIDGE_MAX_INLINE_PER_BLOCK, using ${DEFAULT_MAX_INLINE_PER_BLOCK}`,
    );
  }

  let assets: BridgeAssetConfig[];
  try {
    assets = JSON.parse(assetsJson);
  } catch {
    log.error('[AssetBridge] Invalid BRIDGE_ASSETS JSON');
    assets = [];
  }

  assertBridgeConfigSafeForStartup({
    isProd: config.isProd,
    wsEndpoint,
    adminSeed,
  });

  return new AssetBridgeService({
    wsEndpoint,
    adminSeed,
    assets,
    contractMetadataPath: metadataPath,
    stateFilePath,
    maxInlinePerBlock,
  });
}

if (require.main === module) {
  const bridge = createBridgeFromEnv();

  bridge.start().catch((err) => {
    log.error({ err }, '[AssetBridge] Fatal error');
    process.exit(1);
  });

  // SEC R9: same graceful path for PM2 (SIGINT) and docker/systemd (SIGTERM).
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, '[AssetBridge] Shutting down...');
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

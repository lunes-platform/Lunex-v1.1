import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// --- Chain/contract mocks (no node, no DB) ---------------------------------
// Keyring is mocked so the service never needs the sr25519 WASM; ApiPromise is
// replaced by the per-test `mockChain.api`; ContractPromise keeps the REAL
// `Abi` (event decoding is what is under test) but routes tx/query to mocks.

const mockBridgeAddress = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const mockChain: { api: unknown } = { api: undefined };
const mockContractTx = jest.fn();
const mockContractQuery = jest.fn();

jest.mock('@polkadot/api', () => {
  const actual = jest.requireActual('@polkadot/api');
  return {
    ...actual,
    WsProvider: jest.fn(),
    ApiPromise: { create: jest.fn(async () => mockChain.api) },
    Keyring: jest.fn().mockImplementation(() => ({
      addFromUri: () => ({ address: mockBridgeAddress }),
    })),
  };
});

jest.mock('@polkadot/api-contract', () => {
  const actual = jest.requireActual('@polkadot/api-contract');
  class MockContractPromise {
    readonly abi: InstanceType<typeof actual.Abi>;
    readonly tx: Record<string, (...args: unknown[]) => unknown> = {};
    readonly query: Record<string, (...args: unknown[]) => unknown> = {};
    constructor(_api: unknown, metadata: unknown, address: string) {
      this.abi = new actual.Abi(metadata);
      // Keyed exactly like the real ContractPromise (camelCase `method`).
      for (const message of this.abi.messages) {
        this.tx[message.method] = (_options: unknown, ...args: unknown[]) =>
          mockContractTx(address, message.method, args);
        this.query[message.method] = (
          _origin: unknown,
          _options: unknown,
          ...args: unknown[]
        ) => mockContractQuery(address, message.method, args);
      }
    }
  }
  return { ...actual, ContractPromise: MockContractPromise };
});

const ORIGINAL_ENV = process.env;

function loadCreateBridgeFromEnv() {
  jest.resetModules();
  return require('../services/assetBridgeService') as typeof import('../services/assetBridgeService');
}

describe('asset bridge startup guards', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.BRIDGE_ADMIN_SEED;
    delete process.env.LUNES_WS_URL;
    process.env.NODE_ENV = 'production';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejects missing BRIDGE_ADMIN_SEED before signer creation', () => {
    const { createBridgeFromEnv } = loadCreateBridgeFromEnv();
    expect(() => createBridgeFromEnv()).toThrow(
      'BRIDGE_ADMIN_SEED is required for asset bridge startup',
    );
  });

  it('rejects development bridge admin seeds', () => {
    process.env.BRIDGE_ADMIN_SEED = '//Alice';
    const { createBridgeFromEnv } = loadCreateBridgeFromEnv();
    expect(() => createBridgeFromEnv()).toThrow(
      'BRIDGE_ADMIN_SEED must not use a development account for asset bridge startup',
    );
  });

  it('rejects placeholder bridge admin seeds', () => {
    process.env.BRIDGE_ADMIN_SEED = 'REPLACE_WITH_PRODUCTION_BRIDGE_ADMIN_SEED';
    const { createBridgeFromEnv } = loadCreateBridgeFromEnv();
    expect(() => createBridgeFromEnv()).toThrow(
      'BRIDGE_ADMIN_SEED still contains a placeholder value for asset bridge startup',
    );
  });

  it('rejects local LUNES_WS_URL in production', () => {
    process.env.BRIDGE_ADMIN_SEED = 'real bridge seed from secret manager';
    process.env.LUNES_WS_URL = 'ws://127.0.0.1:9944';
    const { createBridgeFromEnv } = loadCreateBridgeFromEnv();
    expect(() => createBridgeFromEnv()).toThrow(
      'LUNES_WS_URL must not point to localhost for asset bridge startup',
    );
  });
});

// --- asset_wrapper ink! 4 metadata fixture ----------------------------------
// No compiled asset_wrapper ABI is committed in this checkout (the only build
// found elsewhere predates the escrow and has no WithdrawQueued). This fixture
// mirrors Lunex/contracts/asset_wrapper/src/lib.rs: `spec.events` MUST keep the
// `#[ink(event)]` declaration order, because ink 4 encodes an event as
// `[variant index u8] ++ SCALE(all fields)` and the index is that order.

const T = {
  u32: 0,
  accountId: 1,
  u8x32: 2,
  u8: 3,
  u128: 4,
  u64: 5,
  optionAccountId: 6,
  unit: 7,
  langError: 8,
  constructorResult: 9,
  wrapperError: 10,
  unitOrWrapperError: 11,
  messageResult: 12,
  hash: 13,
  noChainExtension: 14,
};

const WRAPPER_ERRORS = [
  'InsufficientBalance',
  'InsufficientAllowance',
  'ZeroAmount',
  'SelfTransfer',
  'Overflow',
  'Unauthorized',
  'Paused',
  'DepositAlreadyProcessed',
  'MintCapExceeded',
  'AdminUnchanged',
  'WithdrawalNotFound',
  'WithdrawalNotExpired',
  'WithdrawalAlreadyProcessed',
  'NotWithdrawalOwner',
];

function resultType(id: number, ok: number, err: number) {
  return {
    id,
    type: {
      def: {
        variant: {
          variants: [
            { fields: [{ type: ok }], index: 0, name: 'Ok' },
            { fields: [{ type: err }], index: 1, name: 'Err' },
          ],
        },
      },
      params: [
        { name: 'T', type: ok },
        { name: 'E', type: err },
      ],
      path: ['Result'],
    },
  };
}

function eventArg(label: string, type: number, name: string, indexed = false) {
  return { docs: [], indexed, label, type: { displayName: [name], type } };
}

function message(label: string, selector: string, args: unknown[]) {
  return {
    args,
    default: false,
    docs: [],
    label,
    mutates: true,
    payable: false,
    returnType: {
      displayName: ['ink', 'MessageResult'],
      type: T.messageResult,
    },
    selector,
  };
}

const owner = (indexed = true) =>
  eventArg('owner', T.accountId, 'AccountId', indexed);
const amount = eventArg('amount', T.u128, 'Balance');
const withdrawalId = eventArg('id', T.u64, 'WithdrawalId');

const WRAPPER_EVENTS = [
  {
    label: 'Transfer',
    args: [
      eventArg('from', T.optionAccountId, 'Option', true),
      eventArg('to', T.optionAccountId, 'Option', true),
      eventArg('value', T.u128, 'Balance'),
    ],
  },
  {
    label: 'Approval',
    args: [
      owner(),
      eventArg('spender', T.accountId, 'AccountId', true),
      eventArg('value', T.u128, 'Balance'),
    ],
  },
  {
    label: 'Mint',
    args: [
      eventArg('to', T.accountId, 'AccountId', true),
      amount,
      eventArg('asset_id', T.u32, 'u32'),
      eventArg('deposit_ref', T.u64, 'u64'),
    ],
  },
  {
    label: 'WithdrawRequest',
    args: [
      eventArg('from', T.accountId, 'AccountId', true),
      amount,
      eventArg('asset_id', T.u32, 'u32'),
    ],
  },
  {
    label: 'WithdrawQueued',
    args: [
      owner(),
      amount,
      eventArg('deadline_block', T.u32, 'u32'),
      withdrawalId,
    ],
  },
  { label: 'WithdrawConfirmed', args: [owner(), amount, withdrawalId] },
  { label: 'WithdrawReclaimed', args: [owner(), amount, withdrawalId] },
  {
    label: 'AdminChanged',
    args: [
      eventArg('old_admin', T.accountId, 'AccountId', true),
      eventArg('new_admin', T.accountId, 'AccountId', true),
    ],
  },
  {
    label: 'ContractPaused',
    args: [eventArg('by', T.accountId, 'AccountId', true)],
  },
  {
    label: 'ContractUnpaused',
    args: [eventArg('by', T.accountId, 'AccountId', true)],
  },
].map((event) => ({ ...event, docs: [] }));

const EVENT_INDEX = {
  Transfer: 0,
  Approval: 1,
  Mint: 2,
  WithdrawQueued: 4,
  WithdrawConfirmed: 5,
  WithdrawReclaimed: 6,
};

function wrapperMetadata(options: { escrow: boolean } = { escrow: true }) {
  const escrowOnly = new Set([
    'WithdrawQueued',
    'WithdrawConfirmed',
    'WithdrawReclaimed',
  ]);
  const idArg = { label: 'id', type: { displayName: ['u64'], type: T.u64 } };
  return {
    source: {
      hash: '0x' + '00'.repeat(32),
      language: 'ink! 4.3.0',
      compiler: 'rustc 1.85.0',
    },
    contract: {
      name: 'asset_wrapper_contract',
      version: '0.1.0',
      authors: ['Lunes'],
    },
    spec: {
      constructors: [
        {
          args: [],
          default: false,
          docs: [],
          label: 'new',
          payable: false,
          returnType: {
            displayName: ['ink_primitives', 'ConstructorResult'],
            type: T.constructorResult,
          },
          selector: '0x9bae9d5e',
        },
      ],
      docs: [],
      environment: {
        accountId: { displayName: ['AccountId'], type: T.accountId },
        balance: { displayName: ['Balance'], type: T.u128 },
        blockNumber: { displayName: ['BlockNumber'], type: T.u32 },
        chainExtension: {
          displayName: ['ChainExtension'],
          type: T.noChainExtension,
        },
        hash: { displayName: ['Hash'], type: T.hash },
        maxEventTopics: 4,
        timestamp: { displayName: ['Timestamp'], type: T.u64 },
      },
      events: options.escrow
        ? WRAPPER_EVENTS
        : WRAPPER_EVENTS.filter((event) => !escrowOnly.has(event.label)),
      lang_error: { displayName: ['ink', 'LangError'], type: T.langError },
      messages: [
        message('approve', '0xb20f1bbd', []),
        message('mint_with_ref', '0x7849c97d', [
          {
            label: 'to',
            type: { displayName: ['AccountId'], type: T.accountId },
          },
          { label: 'amount', type: { displayName: ['Balance'], type: T.u128 } },
          { label: 'deposit_ref', type: { displayName: ['u64'], type: T.u64 } },
        ]),
        ...(options.escrow
          ? [
              message('confirm_withdraw', '0x8a329069', [idArg]),
              message('reclaim_withdraw', '0x64845bd4', [idArg]),
            ]
          : []),
      ],
    },
    storage: {
      root: {
        layout: { struct: { fields: [], name: 'AssetWrapperContract' } },
        root_key: '0x00000000',
      },
    },
    types: [
      { id: T.u32, type: { def: { primitive: 'u32' } } },
      {
        id: T.accountId,
        type: {
          def: {
            composite: { fields: [{ type: T.u8x32, typeName: '[u8; 32]' }] },
          },
          path: ['ink_primitives', 'types', 'AccountId'],
        },
      },
      { id: T.u8x32, type: { def: { array: { len: 32, type: T.u8 } } } },
      { id: T.u8, type: { def: { primitive: 'u8' } } },
      { id: T.u128, type: { def: { primitive: 'u128' } } },
      { id: T.u64, type: { def: { primitive: 'u64' } } },
      {
        id: T.optionAccountId,
        type: {
          def: {
            variant: {
              variants: [
                { index: 0, name: 'None' },
                { fields: [{ type: T.accountId }], index: 1, name: 'Some' },
              ],
            },
          },
          params: [{ name: 'T', type: T.accountId }],
          path: ['Option'],
        },
      },
      { id: T.unit, type: { def: { tuple: [] } } },
      {
        id: T.langError,
        type: {
          def: {
            variant: { variants: [{ index: 1, name: 'CouldNotReadInput' }] },
          },
          path: ['ink_primitives', 'LangError'],
        },
      },
      resultType(T.constructorResult, T.unit, T.langError),
      {
        id: T.wrapperError,
        type: {
          def: {
            variant: {
              variants: WRAPPER_ERRORS.map((name, index) => ({ index, name })),
            },
          },
          path: [
            'asset_wrapper_contract',
            'asset_wrapper_contract',
            'WrapperError',
          ],
        },
      },
      resultType(T.unitOrWrapperError, T.unit, T.wrapperError),
      resultType(T.messageResult, T.unitOrWrapperError, T.langError),
      {
        id: T.hash,
        type: {
          def: {
            composite: { fields: [{ type: T.u8x32, typeName: '[u8; 32]' }] },
          },
          path: ['ink_primitives', 'types', 'Hash'],
        },
      },
      {
        id: T.noChainExtension,
        type: {
          def: { variant: {} },
          path: ['ink_env', 'types', 'NoChainExtension'],
        },
      },
    ],
    version: '4',
  };
}

// --- Withdrawal / block-processing behaviour --------------------------------

describe('asset bridge withdrawals and block catch-up', () => {
  const WRAPPER = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y';
  const USER = '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy';
  const ATTACKER = '5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw';
  const ASSET_ID = 7;

  type ServiceModule = typeof import('../services/assetBridgeService');
  type HeadCallback = (header: {
    number: { toNumber(): number };
  }) => Promise<void>;
  interface MockResult {
    status: { isFinalized: boolean };
    isError: boolean;
    events: unknown[];
    internalError?: Error;
  }
  type StatusCallback = (result: MockResult) => void;

  let AssetBridgeService: ServiceModule['AssetBridgeService'];
  let registry: import('@polkadot/types').TypeRegistry;
  // Lunes mainnet registry: AccountId.toString() encodes with SS58 prefix 57.
  let lunesRegistry: import('@polkadot/types').TypeRegistry;
  let u8aConcat: typeof import('@polkadot/util').u8aConcat;
  let u8aToHex: typeof import('@polkadot/util').u8aToHex;
  let tmpDir: string;
  let stateFile: string;
  let metadataFile: string;
  let headCallback: HeadCallback | undefined;
  let eventsByBlock: Map<number, unknown[]>;
  let failingBlocks: Set<number>;
  let getBlockHash: jest.Mock;
  let assetTransfer: jest.Mock;
  let assetTransferFails: boolean;
  let bridgeBalance: string;
  let chainNextIndex: number;
  let sentNonces: number[];
  let Abi: typeof import('@polkadot/api-contract').Abi;

  beforeAll(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
    jest.resetModules();
    ({ AssetBridgeService } = require('../services/assetBridgeService'));
    ({ Abi } =
      require('@polkadot/api-contract') as typeof import('@polkadot/api-contract'));
    const types =
      require('@polkadot/types') as typeof import('@polkadot/types');
    ({ u8aConcat, u8aToHex } =
      require('@polkadot/util') as typeof import('@polkadot/util'));
    registry = new types.TypeRegistry();
    lunesRegistry = new types.TypeRegistry();
    lunesRegistry.setChainProperties(
      lunesRegistry.createType('ChainProperties', {
        ss58Format: 57,
      }) as import('@polkadot/types').GenericChainProperties,
    );
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ink 4 event payload: [variant index] ++ SCALE(fields)
  const accountBytes = (address: string) =>
    registry.createType('AccountId', address).toU8a();
  const encode = (type: string, value: unknown) =>
    registry.createType(type, value).toU8a();

  function withdrawQueuedPayload(id: number, value: string, deadline = 999) {
    return u8aConcat(
      new Uint8Array([EVENT_INDEX.WithdrawQueued]),
      accountBytes(USER),
      encode('u128', value),
      encode('u32', deadline),
      encode('u64', id),
    );
  }

  function withdrawConfirmedPayload(id: number) {
    return u8aConcat(
      new Uint8Array([EVENT_INDEX.WithdrawConfirmed]),
      accountBytes(USER),
      encode('u128', 1),
      encode('u64', id),
    );
  }

  function withdrawReclaimedPayload(id: number) {
    return u8aConcat(
      new Uint8Array([EVENT_INDEX.WithdrawReclaimed]),
      accountBytes(USER),
      encode('u128', 1),
      encode('u64', id),
    );
  }

  function mintPayload(depositRef: number, value = '500') {
    return u8aConcat(
      new Uint8Array([EVENT_INDEX.Mint]),
      accountBytes(USER),
      encode('u128', value),
      encode('u32', ASSET_ID),
      encode('u64', depositRef),
    );
  }

  const applyExtrinsic = (index: number) => ({
    isApplyExtrinsic: true,
    asApplyExtrinsic: { toNumber: () => index },
  });

  /** assets.Transferred(assetId, from, to, amount) to the bridge account. */
  function transferredToBridge(value: string, extrinsicIndex = 1) {
    return transferredTo(mockBridgeAddress, value, registry, extrinsicIndex);
  }

  function transferredTo(
    to: string,
    value: string,
    chainRegistry: import('@polkadot/types').TypeRegistry,
    extrinsicIndex = 1,
  ) {
    return {
      phase: applyExtrinsic(extrinsicIndex),
      event: {
        section: 'assets',
        method: 'Transferred',
        data: [
          chainRegistry.createType('u32', ASSET_ID),
          chainRegistry.createType('AccountId', USER),
          chainRegistry.createType('AccountId', to),
          chainRegistry.createType('u128', value),
        ],
      },
      topics: [],
    };
  }

  const otherEvent = {
    phase: applyExtrinsic(0),
    event: { section: 'timestamp', method: 'Set', data: [] },
    topics: [],
  };

  function contractEmitted(
    contract: string,
    payload: Uint8Array,
    chainRegistry = registry,
  ) {
    return {
      phase: applyExtrinsic(1),
      event: {
        section: 'contracts',
        method: 'ContractEmitted',
        data: [
          chainRegistry.createType('AccountId', contract),
          // hex input = raw bytes (a Uint8Array would be read as length-prefixed)
          chainRegistry.createType('Bytes', u8aToHex(payload)),
        ],
      },
      topics: [],
    };
  }

  const extrinsicFailed = {
    event: { section: 'system', method: 'ExtrinsicFailed', data: [] },
  };

  const extrinsicSuccess = {
    event: { section: 'system', method: 'ExtrinsicSuccess', data: [] },
  };

  function finalized(events: unknown[] = []): MockResult {
    return { status: { isFinalized: true }, isError: false, events };
  }

  /** Finalized and dispatched: `events` followed by system.ExtrinsicSuccess. */
  function succeeded(events: unknown[] = []): MockResult {
    return finalized([...events, extrinsicSuccess]);
  }

  /**
   * What @polkadot/api delivers when the post-finalization events fetch fails:
   * status Finalized, no events, `internalError` set, `isError` false.
   */
  function finalizedWithoutEvents(internalError?: Error): MockResult {
    return { ...finalized([]), internalError };
  }

  /** Like `sends`, but the status callback fires after `ms` milliseconds. */
  function sendsAfter(ms: number, result: MockResult) {
    return {
      signAndSend: (
        _pair: unknown,
        opts: { nonce: number },
        cb: StatusCallback,
      ) => {
        sentNonces.push(opts.nonce);
        setTimeout(() => cb(result), ms);
        return Promise.resolve(() => undefined);
      },
    };
  }

  async function waitFor(condition: () => boolean, label: string) {
    for (let i = 0; i < 200 && !condition(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (!condition()) throw new Error(`waitFor timed out: ${label}`);
  }

  function sends(result: MockResult) {
    return {
      signAndSend: (
        _pair: unknown,
        opts: { nonce: number },
        cb: StatusCallback,
      ) => {
        sentNonces.push(opts.nonce);
        cb(result);
        return Promise.resolve(() => undefined);
      },
    };
  }

  /** Broadcast accepted but the status callback never fires (lost / slow). */
  function hangs() {
    return {
      signAndSend: (_pair: unknown, opts: { nonce: number }) => {
        sentNonces.push(opts.nonce);
        return Promise.resolve(() => undefined);
      },
    };
  }

  /** signAndSend rejects before the extrinsic reaches the pool. */
  function rejectsBeforeBroadcast() {
    return {
      signAndSend: (_pair: unknown, opts: { nonce: number }) => {
        sentNonces.push(opts.nonce);
        return Promise.reject(new Error('ws disconnected'));
      },
    };
  }

  const dryRunOk = {
    gasRequired: {
      refTime: { toBigInt: () => 1_000_000n },
      proofSize: { toBigInt: () => 10_000n },
    },
    result: { isErr: false, asOk: { flags: { isRevert: false } } },
    output: null,
  };

  /**
   * Dry-run that reverts with `Err(wrapperError)`, with `output` decoded the
   * way @polkadot/api-contract does it: the message's ink 4 MessageResult
   * `Result<Result<(), WrapperError>, LangError>` built from the fixture ABI.
   */
  function dryRunReverts(method: string, wrapperError: string) {
    const abi = new Abi(wrapperMetadata());
    const returnType = abi.messages.find(
      (m) => m.method === method,
    )!.returnType!;
    return {
      ...dryRunOk,
      result: { isErr: false, asOk: { flags: { isRevert: true } } },
      output: abi.registry.createTypeUnsafe(
        returnType.lookupName || returnType.type,
        [{ Ok: { Err: wrapperError } }],
      ),
    };
  }

  const mintCalls = () =>
    mockContractTx.mock.calls.filter(([, method]) => method === 'mintWithRef');

  const confirmCalls = () =>
    mockContractTx.mock.calls.filter(
      ([, method]) => method === 'confirmWithdraw',
    );

  const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  function seedState(lastProcessedBlock: number) {
    fs.writeFileSync(
      stateFile,
      // `processedWithdrawals` is the legacy (pre-fix) field, kept so a state
      // file written by the old relayer still loads.
      JSON.stringify({
        lastProcessedBlock,
        processedDeposits: {},
        processedWithdrawals: {},
        withdrawals: {},
      }),
    );
  }

  function buildApi() {
    return {
      isReady: Promise.resolve(),
      registry,
      createType: registry.createType.bind(registry),
      disconnect: jest.fn(async () => undefined),
      rpc: {
        system: {
          accountNextIndex: jest.fn(async () => ({
            toNumber: () => chainNextIndex,
          })),
        },
        chain: {
          subscribeFinalizedHeads: jest.fn(async (cb: HeadCallback) => {
            headCallback = cb;
            return () => undefined;
          }),
          getBlockHash,
        },
      },
      query: {
        system: {
          events: {
            at: jest.fn(async (hash: string) => {
              const blockNumber = Number(hash.replace('hash-', ''));
              if (failingBlocks.has(blockNumber)) {
                failingBlocks.delete(blockNumber);
                throw new Error(`RPC error at block ${blockNumber}`);
              }
              return eventsByBlock.get(blockNumber) ?? [];
            }),
          },
        },
        assets: {
          account: jest.fn(async () => ({
            isNone: false,
            unwrap: () => ({
              balance: {
                toBn: () => new (require('@polkadot/util').BN)(bridgeBalance),
              },
            }),
          })),
        },
      },
      tx: { assets: { transfer: assetTransfer } },
    };
  }

  type BridgeOptions = {
    maxInlinePerBlock?: number;
    minDepositAmount?: string;
  };

  async function startService(
    metadata = wrapperMetadata(),
    options: BridgeOptions = {},
  ) {
    fs.writeFileSync(metadataFile, JSON.stringify(metadata));
    mockChain.api = buildApi();
    const service = new AssetBridgeService({
      wsEndpoint: 'ws://mock',
      adminSeed: 'mock seed',
      assets: [
        {
          assetId: ASSET_ID,
          wrapperAddress: WRAPPER,
          symbol: 'wTEST',
          ...(options.minDepositAmount !== undefined
            ? { minDepositAmount: options.minDepositAmount }
            : {}),
        },
      ],
      contractMetadataPath: metadataFile,
      stateFilePath: stateFile,
      txTimeoutMs: 50,
      ...(options.maxInlinePerBlock !== undefined
        ? { maxInlinePerBlock: options.maxInlinePerBlock }
        : {}),
    });
    await service.start();
    return service;
  }

  const head = (blockNumber: number) =>
    headCallback!({ number: { toNumber: () => blockNumber } });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-bridge-test-'));
    stateFile = path.join(tmpDir, 'bridge-state.json');
    metadataFile = path.join(tmpDir, 'asset_wrapper_contract.json');
    headCallback = undefined;
    eventsByBlock = new Map();
    failingBlocks = new Set();
    assetTransferFails = false;
    bridgeBalance = '1' + '0'.repeat(30);
    chainNextIndex = 0;
    sentNonces = [];
    getBlockHash = jest.fn(
      async (blockNumber: number) => `hash-${blockNumber}`,
    );
    assetTransfer = jest.fn(() =>
      sends(assetTransferFails ? finalized([extrinsicFailed]) : succeeded()),
    );
    mockContractTx.mockReset();
    mockContractQuery.mockReset();
    mockContractQuery.mockResolvedValue(dryRunOk);
    mockContractTx.mockImplementation(
      (_address: string, method: string, args: unknown[]) => {
        if (method === 'mintWithRef') {
          const ref = Number(String(args[2]));
          return sends(succeeded([contractEmitted(WRAPPER, mintPayload(ref))]));
        }
        if (method !== 'confirmWithdraw')
          throw new Error(`unexpected tx ${method}`);
        const id = Number(String(args[0]));
        return sends(
          succeeded([contractEmitted(WRAPPER, withdrawConfirmedPayload(id))]),
        );
      },
    );
  });

  afterEach(() => {
    fs.chmodSync(tmpDir, 0o700);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignores Approval (81 bytes) and Transfer events from the wrapper', async () => {
    // approve(spender, value) is free for anyone and the spender bytes are
    // attacker-chosen. The legacy raw parser read payload[32..48] as the u128
    // amount and payload[48..52] as the assetId, i.e. spender[0..15] and
    // spender[15..19]: craft a small amount and a real assetId there.
    const spender = new Uint8Array(32);
    spender.set(encode('u32', ASSET_ID), 15);
    const approval = u8aConcat(
      new Uint8Array([EVENT_INDEX.Approval]),
      accountBytes(ATTACKER),
      spender,
      encode('u128', '5000000'),
    );
    expect(approval.length).toBe(81);
    const transfer = u8aConcat(
      new Uint8Array([EVENT_INDEX.Transfer]),
      encode('Option<AccountId>', ATTACKER),
      encode('Option<AccountId>', USER),
      encode('u128', '5000000'),
    );
    seedState(10);
    eventsByBlock.set(11, [
      contractEmitted(WRAPPER, approval),
      contractEmitted(WRAPPER, transfer),
    ]);

    await startService();
    await head(11);

    expect(assetTransfer).not.toHaveBeenCalled();
    expect(confirmCalls()).toHaveLength(0);
    expect(readState().lastProcessedBlock).toBe(11);
  });

  it('delivers a WithdrawQueued exactly once: confirm_withdraw(id) then send with the configured assetId', async () => {
    seedState(10);
    eventsByBlock.set(11, [
      contractEmitted(WRAPPER, withdrawQueuedPayload(42, '1000')),
    ]);

    const service = await startService();
    await head(11);

    expect(confirmCalls()).toHaveLength(1);
    expect(confirmCalls()[0][0]).toBe(WRAPPER);
    expect(String(confirmCalls()[0][2][0])).toBe('42');
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    const [assetId, to, value] = assetTransfer.mock.calls[0];
    expect(assetId).toBe(ASSET_ID);
    expect(to).toBe(USER);
    expect(value.toString()).toBe('1000');
    // confirm (escrow burn) must land before the native transfer is sent
    expect(mockContractTx.mock.invocationCallOrder[0]).toBeLessThan(
      assetTransfer.mock.invocationCallOrder[0],
    );
    expect(readState().withdrawals[`${WRAPPER}:42`].status).toBe('DONE');

    // Crash before the cursor was persisted: restart and replay block 11, and
    // the same id shows up again in a later block. Neither repeats anything.
    await service.stop();
    seedStateKeepingWithdrawals(10);
    eventsByBlock.set(12, [
      contractEmitted(WRAPPER, withdrawQueuedPayload(42, '1000')),
    ]);
    await startService();
    await head(12);

    expect(confirmCalls()).toHaveLength(1);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(readState().lastProcessedBlock).toBe(12);
  });

  function seedStateKeepingWithdrawals(lastProcessedBlock: number) {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ ...readState(), lastProcessedBlock }),
    );
  }

  it.each([
    [
      'the extrinsic fails',
      () =>
        mockContractTx.mockImplementation(() =>
          sends(finalized([extrinsicFailed])),
        ),
    ],
    [
      'the dry-run reverts',
      () =>
        mockContractQuery.mockResolvedValue({
          gasRequired: {
            refTime: { toBigInt: () => 1n },
            proofSize: { toBigInt: () => 1n },
          },
          result: { isErr: false, asOk: { flags: { isRevert: true } } },
        }),
    ],
    [
      'no WithdrawConfirmed(id) is emitted',
      () => mockContractTx.mockImplementation(() => sends(succeeded([]))),
    ],
  ])(
    'does not send when confirm_withdraw fails (%s)',
    async (_label, arrange) => {
      arrange();
      seedState(10);
      eventsByBlock.set(11, [
        contractEmitted(WRAPPER, withdrawQueuedPayload(7, '1000')),
      ]);

      await startService();
      await head(11);

      expect(assetTransfer).not.toHaveBeenCalled();
      const record = readState().withdrawals[`${WRAPPER}:7`];
      expect(record.status).toBe('PENDING');
      expect(record.lastError).toEqual(expect.any(String));
    },
  );

  it('keeps a confirmed-but-undelivered withdrawal visible and never resends it', async () => {
    assetTransferFails = true;
    seedState(10);
    eventsByBlock.set(11, [
      contractEmitted(WRAPPER, withdrawQueuedPayload(9, '1000')),
    ]);

    const service = await startService();
    await head(11);

    expect(assetTransfer).toHaveBeenCalledTimes(1);
    const record = readState().withdrawals[`${WRAPPER}:9`];
    expect(record.status).toBe('CONFIRMED');
    expect(record.lastError).toEqual(expect.any(String));

    await service.stop();
    assetTransferFails = false;
    seedStateKeepingWithdrawals(10);
    await startService();
    await head(11);

    expect(confirmCalls()).toHaveLength(1);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(readState().withdrawals[`${WRAPPER}:9`].status).toBe('CONFIRMED');
  });

  it('processes every block between the cursor and the finalized head, in order', async () => {
    seedState(10);

    await startService();
    await head(13);

    expect(getBlockHash.mock.calls.map(([n]) => n)).toEqual([11, 12, 13]);
    expect(readState().lastProcessedBlock).toBe(13);
  });

  it('stops at a failing block, keeps the cursor before it and retries it on the next head', async () => {
    seedState(10);
    failingBlocks.add(12);

    await startService();
    await head(13);

    expect(getBlockHash.mock.calls.map(([n]) => n)).toEqual([11, 12]);
    expect(readState().lastProcessedBlock).toBe(11);

    await head(14);

    expect(getBlockHash.mock.calls.map(([n]) => n)).toEqual([
      11, 12, 12, 13, 14,
    ]);
    expect(readState().lastProcessedBlock).toBe(14);
  });

  it('does not process a block twice when heads arrive while catching up', async () => {
    seedState(10);

    await startService();
    await Promise.all([head(12), head(13), head(13)]);
    // a head that arrived mid-run is drained by the run already in progress
    await head(13);

    expect(getBlockHash.mock.calls.map(([n]) => n)).toEqual([11, 12, 13]);
    expect(readState().lastProcessedBlock).toBe(13);
  });

  it('starts at the current head when there is no persisted cursor', async () => {
    await startService();
    await head(50);

    expect(getBlockHash.mock.calls.map(([n]) => n)).toEqual([50]);
    expect(readState().lastProcessedBlock).toBe(50);
  });

  it('refuses to start with a wrapper ABI that predates the withdrawal escrow', async () => {
    await expect(
      startService(wrapperMetadata({ escrow: false })),
    ).rejects.toThrow(/WithdrawQueued/);
  });
  // --- R1: the finalized block stream settles ambiguous confirms ----------

  const queued = (id: number, value = '1000') =>
    contractEmitted(WRAPPER, withdrawQueuedPayload(id, value));
  const confirmedEvent = (id: number) =>
    contractEmitted(WRAPPER, withdrawConfirmedPayload(id));
  const reclaimedEvent = (id: number) =>
    contractEmitted(WRAPPER, withdrawReclaimedPayload(id));
  const withdrawal = (id: number) =>
    readState().withdrawals[`${WRAPPER}:${id}`];

  /** confirm_withdraw(id) for these ids is broadcast but never reports back. */
  function confirmHangsFor(...ids: number[]) {
    const fallback = mockContractTx.getMockImplementation()!;
    mockContractTx.mockImplementation(
      (address: string, method: string, args: unknown[]) =>
        method === 'confirmWithdraw' && ids.includes(Number(String(args[0])))
          ? hangs()
          : fallback(address, method, args),
    );
  }

  it('confirm times out, then WithdrawConfirmed(id) in a later block delivers exactly once', async () => {
    confirmHangsFor(5);
    seedState(10);
    eventsByBlock.set(11, [queued(5)]);
    eventsByBlock.set(12, [confirmedEvent(5)]);
    eventsByBlock.set(13, [confirmedEvent(5)]);

    await startService();
    await head(11);

    expect(withdrawal(5).status).toBe('CONFIRMING');
    expect(assetTransfer).not.toHaveBeenCalled();

    await head(13);

    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(assetTransfer.mock.calls[0][1]).toBe(USER);
    expect(withdrawal(5).status).toBe('DONE');
    expect(confirmCalls()).toHaveLength(1);
  });

  it('confirm times out and no event arrives: stays CONFIRMING, nothing sent, no second confirm', async () => {
    confirmHangsFor(5);
    seedState(10);
    eventsByBlock.set(11, [queued(5)]);
    eventsByBlock.set(12, [queued(5)]); // re-observed WithdrawQueued

    await startService();
    await head(12);
    await head(40); // well past the retry throttle

    expect(confirmCalls()).toHaveLength(1);
    expect(assetTransfer).not.toHaveBeenCalled();
    expect(withdrawal(5).status).toBe('CONFIRMING');
    expect(withdrawal(5).lastError).toMatch(/timed out/);
  });

  it('WithdrawReclaimed closes a PENDING and a CONFIRMING record without sending', async () => {
    confirmHangsFor(2);
    mockContractQuery.mockImplementation(
      async (_address: string, method: string, args: unknown[]) =>
        method === 'confirmWithdraw' && String(args[0]) === '1'
          ? dryRunReverts('confirmWithdraw', 'WithdrawalNotExpired')
          : dryRunOk,
    );
    seedState(10);
    eventsByBlock.set(11, [queued(1), queued(2)]);
    eventsByBlock.set(12, [reclaimedEvent(1), reclaimedEvent(2)]);

    await startService();
    await head(11);

    expect(withdrawal(1).status).toBe('PENDING');
    expect(withdrawal(2).status).toBe('CONFIRMING');

    await head(12);
    await head(40);

    expect(withdrawal(1).status).toBe('RECLAIMED');
    expect(withdrawal(2).status).toBe('RECLAIMED');
    expect(assetTransfer).not.toHaveBeenCalled();
    expect(confirmCalls()).toHaveLength(1);
  });

  it('WithdrawConfirmed for a PENDING record marks it CONFIRMED (external) and does not send', async () => {
    mockContractQuery.mockResolvedValue(
      dryRunReverts('confirmWithdraw', 'Paused'),
    );
    seedState(10);
    eventsByBlock.set(11, [queued(3)]);
    eventsByBlock.set(12, [confirmedEvent(3)]);

    await startService();
    await head(12);

    expect(withdrawal(3).status).toBe('CONFIRMED');
    expect(withdrawal(3).lastError).toMatch(/external/i);
    expect(assetTransfer).not.toHaveBeenCalled();
    expect(confirmCalls()).toHaveLength(0);
  });

  it('WithdrawConfirmed for DONE and for CONFIRMED records never sends again', async () => {
    assetTransfer
      .mockImplementationOnce(() => sends(succeeded()))
      .mockImplementationOnce(() => sends(finalized([extrinsicFailed])));
    seedState(10);
    eventsByBlock.set(11, [queued(4), queued(6)]);
    eventsByBlock.set(12, [confirmedEvent(4), confirmedEvent(6)]);

    await startService();
    await head(12);

    expect(withdrawal(4).status).toBe('DONE');
    expect(withdrawal(6).status).toBe('CONFIRMED');
    expect(assetTransfer).toHaveBeenCalledTimes(2);
  });

  it('a PENDING left by insufficient bridge balance is delivered by the retry after top-up, exactly once', async () => {
    bridgeBalance = '10';
    seedState(10);
    eventsByBlock.set(11, [queued(8, '1000')]);

    await startService();
    await head(11);

    expect(withdrawal(8).status).toBe('PENDING');
    expect(confirmCalls()).toHaveLength(0);

    bridgeBalance = '1' + '0'.repeat(30);
    await head(15); // inside the retry throttle window

    expect(confirmCalls()).toHaveLength(0);

    await head(21);

    expect(confirmCalls()).toHaveLength(1);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(withdrawal(8).status).toBe('DONE');

    await head(40);

    expect(confirmCalls()).toHaveLength(1);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
  });

  // --- R2: submissions cannot wedge the nonce or the block loop ------------

  it('a submission rejected before broadcast is followed by a nonce resync for the next extrinsic', async () => {
    let first = true;
    mockContractTx.mockImplementation(
      (_address: string, method: string, args: unknown[]) => {
        if (method !== 'mintWithRef')
          throw new Error(`unexpected tx ${method}`);
        if (first) {
          first = false;
          return rejectsBeforeBroadcast();
        }
        const ref = Number(String(args[2]));
        return sends(succeeded([contractEmitted(WRAPPER, mintPayload(ref))]));
      },
    );
    seedState(10);
    eventsByBlock.set(11, [
      transferredToBridge('500', 1),
      transferredToBridge('600', 2),
    ]);

    await startService(); // starting nonce 0
    chainNextIndex = 5; // the chain's next index after the failed submission
    await head(11);

    expect(mintCalls()).toHaveLength(2);
    expect(sentNonces).toEqual([0, 5]);
  });

  it('a send that never calls back times out and leaves the withdrawal CONFIRMED', async () => {
    assetTransfer.mockImplementation(() => hangs());
    seedState(10);
    eventsByBlock.set(11, [queued(9)]);

    await startService();
    await head(11);

    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(withdrawal(9).status).toBe('CONFIRMED');
    expect(withdrawal(9).lastError).toMatch(/timed out/);
    expect(readState().lastProcessedBlock).toBe(11);
  });

  // --- R3: deposits ---------------------------------------------------------

  const deposit = (key: string) => readState().deposits[key];

  it('a deposit mints through mintWithRef and is only marked done on Mint with its ref', async () => {
    seedState(10);
    eventsByBlock.set(11, [otherEvent, transferredToBridge('500')]);

    await startService();
    await head(11);

    expect(mintCalls()).toHaveLength(1);
    const [address, , args] = mintCalls()[0];
    expect(address).toBe(WRAPPER);
    expect(String(args[0])).toBe(USER);
    expect(String(args[1])).toBe('500');
    expect(Number(String(args[2]))).toBe(11 * 10000 + 1);
    expect(deposit('11:1')).toMatchObject({
      status: 'DONE',
      depositRef: 110001,
    });
  });

  it.each([
    ['without any Mint event', () => [extrinsicSuccess]],
    [
      'with a Mint for another ref',
      () => [contractEmitted(WRAPPER, mintPayload(999)), extrinsicSuccess],
    ],
    ['with ExtrinsicFailed', () => [extrinsicFailed]],
  ])(
    'a mint whose extrinsic finalizes %s is kept PENDING and retried',
    async (_label, firstEvents) => {
      const fallback = mockContractTx.getMockImplementation()!;
      let first = true;
      mockContractTx.mockImplementation(
        (address: string, method: string, args: unknown[]) => {
          if (method === 'mintWithRef' && first) {
            first = false;
            return sends(finalized(firstEvents()));
          }
          return fallback(address, method, args);
        },
      );
      seedState(10);
      eventsByBlock.set(11, [transferredToBridge('500')]);

      await startService();
      await head(11);

      expect(deposit('11:0').status).toBe('PENDING');
      expect(deposit('11:0').lastError).toEqual(expect.any(String));

      await head(21);

      expect(mintCalls()).toHaveLength(2);
      expect(deposit('11:0').status).toBe('DONE');
    },
  );

  it('dry-run DepositAlreadyProcessed marks the deposit done without submitting', async () => {
    mockContractQuery.mockResolvedValue(
      dryRunReverts('mintWithRef', 'DepositAlreadyProcessed'),
    );
    seedState(10);
    eventsByBlock.set(11, [transferredToBridge('500')]);

    await startService();
    await head(11);

    expect(mintCalls()).toHaveLength(0);
    expect(deposit('11:0').status).toBe('DONE');
  });

  it('a dry-run revert other than DepositAlreadyProcessed keeps the deposit PENDING', async () => {
    mockContractQuery.mockResolvedValue(
      dryRunReverts('mintWithRef', 'MintCapExceeded'),
    );
    seedState(10);
    eventsByBlock.set(11, [transferredToBridge('500')]);

    await startService();
    await head(11);

    expect(mintCalls()).toHaveLength(0);
    expect(deposit('11:0').status).toBe('PENDING');
    expect(deposit('11:0').lastError).toMatch(/MintCapExceeded/);
  });

  it('two transfers to the bridge in one extrinsic mint twice with different refs', async () => {
    seedState(10);
    eventsByBlock.set(11, [
      transferredToBridge('500', 1),
      transferredToBridge('600', 1),
    ]);

    await startService();
    await head(11);

    expect(mintCalls().map(([, , args]) => Number(String(args[2])))).toEqual([
      110000, 110001,
    ]);
    expect(deposit('11:0').status).toBe('DONE');
    expect(deposit('11:1').status).toBe('DONE');
  });

  it('skips a deposit already recorded in the legacy processedDeposits map', async () => {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        lastProcessedBlock: 10,
        processedDeposits: { '11:1': true }, // legacy "block:extrinsic" key
      }),
    );
    eventsByBlock.set(11, [transferredToBridge('500', 1)]);

    await startService();
    await head(11);

    expect(mintCalls()).toHaveLength(0);
    expect(mockContractQuery).not.toHaveBeenCalled();
  });

  it('refuses a deposit whose event index does not fit deposit_ref instead of colliding', async () => {
    seedState(10);
    eventsByBlock.set(11, [
      ...Array.from({ length: 10000 }, () => otherEvent),
      transferredToBridge('500'),
    ]);

    await startService();
    await head(11);

    expect(mintCalls()).toHaveLength(0);
    // Quarantined, not a poison block: the cursor moves past it.
    expect(readState().lastProcessedBlock).toBe(11);
    expect(deposit('11:10000')).toMatchObject({
      status: 'MANUAL',
      depositRef: null,
      amount: '500',
    });
  });

  it('a quarantined deposit does not stop the rest of its block nor later blocks, and is never retried', async () => {
    seedState(10);
    eventsByBlock.set(11, [
      transferredToBridge('400'),
      ...Array.from({ length: 9999 }, () => otherEvent),
      transferredToBridge('500'),
      queued(30),
    ]);
    eventsByBlock.set(12, [transferredToBridge('600')]);

    await startService();
    await head(12);
    await head(60); // far past the retry throttle

    expect(mintCalls().map(([, , args]) => Number(String(args[2])))).toEqual([
      110000, 120000,
    ]);
    expect(deposit('11:0').status).toBe('DONE');
    expect(deposit('11:10000').status).toBe('MANUAL');
    expect(deposit('11:10000').lastError).toMatch(/deposit_ref/);
    expect(deposit('12:0').status).toBe('DONE');
    expect(withdrawal(30).status).toBe('DONE');
    expect(readState().lastProcessedBlock).toBe(60);
  });

  // --- R4: state durability -------------------------------------------------

  it('refuses to start when the state file is corrupt', async () => {
    fs.writeFileSync(stateFile, '{"lastProcessedBlock": 10, ');

    await expect(startService()).rejects.toThrow(/state file/i);
  });

  it('a state save that fails leaves the block unprocessed and it is retried on the next head', async () => {
    seedState(10);
    await startService();

    fs.chmodSync(tmpDir, 0o500); // no new files: the atomic write must fail
    await head(11);
    fs.chmodSync(tmpDir, 0o700);

    expect(readState().lastProcessedBlock).toBe(10);

    await head(12);

    expect(getBlockHash.mock.calls.map(([n]) => n)).toEqual([11, 11, 12]);
    expect(readState().lastProcessedBlock).toBe(12);
  });

  // --- R6: CONFIRMING is on disk before confirm_withdraw leaves -------------

  it('the state file already says CONFIRMING when confirm_withdraw is signed and sent', async () => {
    const statusOnDisk: string[] = [];
    mockContractTx.mockImplementation(
      (_address: string, method: string, args: unknown[]) => {
        if (method !== 'confirmWithdraw')
          throw new Error(`unexpected tx ${method}`);
        const id = Number(String(args[0]));
        const inner = sends(
          succeeded([contractEmitted(WRAPPER, withdrawConfirmedPayload(id))]),
        );
        return {
          signAndSend: (
            pair: unknown,
            opts: { nonce: number },
            cb: StatusCallback,
          ) => {
            statusOnDisk.push(withdrawal(id).status);
            return inner.signAndSend(pair, opts, cb);
          },
        };
      },
    );
    seedState(10);
    eventsByBlock.set(11, [queued(5)]);

    await startService();
    await head(11);

    expect(statusOnDisk).toEqual(['CONFIRMING']);
    expect(withdrawal(5).status).toBe('DONE');
  });

  it('a failed CONFIRMING save broadcasts nothing, keeps the cursor and leaves PENDING on disk', async () => {
    mockContractQuery.mockImplementation(async (_address, method) => {
      // The PENDING record is already on disk; the CONFIRMING save must fail.
      if (method === 'confirmWithdraw') fs.chmodSync(tmpDir, 0o500);
      return dryRunOk;
    });
    seedState(10);
    eventsByBlock.set(11, [queued(5)]);

    await startService();
    await head(11);
    fs.chmodSync(tmpDir, 0o700);

    expect(sentNonces).toEqual([]); // nothing signed or broadcast
    expect(assetTransfer).not.toHaveBeenCalled();
    expect(readState().lastProcessedBlock).toBe(10);
    expect(withdrawal(5).status).toBe('PENDING');

    // Reopen on the file as it is on disk: the replay confirms exactly once.
    mockContractQuery.mockReset();
    mockContractQuery.mockResolvedValue(dryRunOk);
    await startService();
    await head(11);

    expect(sentNonces).toHaveLength(2); // one confirm + one transfer
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(withdrawal(5).status).toBe('DONE');
    expect(readState().lastProcessedBlock).toBe(11);
  });

  it('after a restart on a CONFIRMING record, WithdrawQueued does not re-confirm and WithdrawConfirmed pays exactly once', async () => {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        lastProcessedBlock: 10,
        processedDeposits: {},
        deposits: {},
        withdrawals: {
          [`${WRAPPER}:5`]: {
            status: 'CONFIRMING',
            assetId: ASSET_ID,
            wrapperAddress: WRAPPER,
            withdrawalId: '5',
            owner: USER,
            amount: '1000',
            blockNumber: 9,
            lastAttemptBlock: 9,
            lastError: 'timed out; outcome unknown',
          },
        },
      }),
    );
    eventsByBlock.set(11, [queued(5)]); // re-observed after the restart
    eventsByBlock.set(41, [confirmedEvent(5)]);
    eventsByBlock.set(42, [confirmedEvent(5), queued(5)]); // replays

    await startService();
    await head(11);
    await head(40); // retries never touch CONFIRMING

    expect(confirmCalls()).toHaveLength(0);
    expect(sentNonces).toEqual([]);
    expect(withdrawal(5).status).toBe('CONFIRMING');

    await head(42);
    await head(60);

    expect(confirmCalls()).toHaveLength(0);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(assetTransfer.mock.calls[0][1]).toBe(USER);
    expect(String(assetTransfer.mock.calls[0][2])).toBe('1000');
    expect(withdrawal(5).status).toBe('DONE');
  });

  // --- R7: a finalized status without dispatch outcome is ambiguous ---------

  it.each([
    ['internalError set', () => new Error('events fetch failed')],
    ['extrinsic not found in the block', () => undefined],
  ])(
    'a confirm that finalizes with no events (%s) stays CONFIRMING and the stream pays it once',
    async (_label, internalError) => {
      const fallback = mockContractTx.getMockImplementation()!;
      mockContractTx.mockImplementation(
        (address: string, method: string, args: unknown[]) =>
          method === 'confirmWithdraw'
            ? sends(finalizedWithoutEvents(internalError()))
            : fallback(address, method, args),
      );
      seedState(10);
      eventsByBlock.set(11, [queued(7)]);
      eventsByBlock.set(12, [confirmedEvent(7)]);

      await startService();
      await head(11);

      expect(withdrawal(7).status).toBe('CONFIRMING');
      expect(withdrawal(7).lastError).toMatch(/outcome unknown/);
      expect(assetTransfer).not.toHaveBeenCalled();

      await head(40);

      expect(confirmCalls()).toHaveLength(1);
      expect(assetTransfer).toHaveBeenCalledTimes(1);
      expect(withdrawal(7).status).toBe('DONE');
    },
  );

  it.each([
    ['internalError set', () => new Error('events fetch failed')],
    ['extrinsic not found in the block', () => undefined],
  ])(
    'a payout that finalizes with no events (%s) is not marked DONE and never resent',
    async (_label, internalError) => {
      assetTransfer.mockImplementation(() =>
        sends(finalizedWithoutEvents(internalError())),
      );
      seedState(10);
      eventsByBlock.set(11, [queued(9)]);
      eventsByBlock.set(12, [confirmedEvent(9)]);

      await startService();
      await head(12);
      await head(40);

      expect(assetTransfer).toHaveBeenCalledTimes(1);
      expect(withdrawal(9).status).toBe('CONFIRMED');
      expect(withdrawal(9).lastError).toMatch(/ambiguous/);
    },
  );

  it('a mint that finalizes with no events and internalError stays PENDING as ambiguous and the retry settles it', async () => {
    const fallback = mockContractTx.getMockImplementation()!;
    let first = true;
    mockContractTx.mockImplementation(
      (address: string, method: string, args: unknown[]) => {
        if (method === 'mintWithRef' && first) {
          first = false;
          return sends(
            finalizedWithoutEvents(new Error('events fetch failed')),
          );
        }
        return fallback(address, method, args);
      },
    );
    seedState(10);
    eventsByBlock.set(11, [transferredToBridge('500')]);

    await startService();
    await head(11);

    expect(deposit('11:0').status).toBe('PENDING');
    expect(deposit('11:0').lastError).toMatch(/ambiguous/);

    await head(21);

    expect(mintCalls()).toHaveLength(2); // same ref: the contract dedups it
    expect(mintCalls().map(([, , args]) => Number(String(args[2])))).toEqual([
      110000, 110000,
    ]);
    expect(deposit('11:0').status).toBe('DONE');
  });

  // --- R8: bounded inline work, retry while behind, minimum deposit ---------

  it('processes at most maxInlinePerBlock items inline; the rest stays PENDING and the retry serves it exactly once', async () => {
    const cursorAtMint: number[] = [];
    const fallback = mockContractTx.getMockImplementation()!;
    mockContractTx.mockImplementation(
      (address: string, method: string, args: unknown[]) => {
        if (method === 'mintWithRef')
          cursorAtMint.push(readState().lastProcessedBlock);
        return fallback(address, method, args);
      },
    );
    seedState(10);
    eventsByBlock.set(11, [
      transferredToBridge('100'),
      transferredToBridge('200'),
      transferredToBridge('300'),
      queued(31),
    ]);

    await startService(wrapperMetadata(), { maxInlinePerBlock: 2 });
    await head(11);

    // two inline while block 11 was being processed, one by the retry after
    expect(cursorAtMint).toEqual([10, 10, 11]);
    expect(mintCalls().map(([, , args]) => Number(String(args[2])))).toEqual([
      110000, 110001, 110002,
    ]);
    expect(confirmCalls()).toHaveLength(1);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(deposit('11:2').status).toBe('DONE');
    expect(withdrawal(31).status).toBe('DONE');

    await head(40);

    expect(mintCalls()).toHaveLength(3);
    expect(confirmCalls()).toHaveLength(1);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
  });

  it('a deferred item is persisted PENDING before the block cursor advances', async () => {
    let cursorAtDeferredMint = -1;
    let deferredOnDisk: { status: string; lastError?: string } | undefined;
    const fallback = mockContractTx.getMockImplementation()!;
    mockContractTx.mockImplementation(
      (address: string, method: string, args: unknown[]) => {
        if (method === 'mintWithRef' && Number(String(args[2])) === 110001) {
          cursorAtDeferredMint = readState().lastProcessedBlock;
          deferredOnDisk = deposit('11:1');
        }
        return fallback(address, method, args);
      },
    );
    seedState(10);
    eventsByBlock.set(11, [
      transferredToBridge('100'),
      transferredToBridge('200'),
    ]);

    await startService(wrapperMetadata(), { maxInlinePerBlock: 1 });
    await head(11);

    expect(cursorAtDeferredMint).toBe(11);
    expect(deferredOnDisk).toMatchObject({
      status: 'PENDING',
      lastError: expect.stringMatching(/deferred/),
    });
    expect(deposit('11:1').status).toBe('DONE');
  });

  it('retries PENDING records while catching up, not only once the head is reached', async () => {
    let cursorAtConfirm = -1;
    const fallback = mockContractTx.getMockImplementation()!;
    mockContractTx.mockImplementation(
      (address: string, method: string, args: unknown[]) => {
        if (method === 'confirmWithdraw')
          cursorAtConfirm = readState().lastProcessedBlock;
        return fallback(address, method, args);
      },
    );
    bridgeBalance = '10';
    seedState(10);
    eventsByBlock.set(11, [queued(8, '1000')]);

    await startService();
    await head(11);

    expect(withdrawal(8).status).toBe('PENDING');

    bridgeBalance = '1' + '0'.repeat(30);
    await head(40); // one run from 12 to 40

    expect(confirmCalls()).toHaveLength(1);
    expect(cursorAtConfirm).toBe(21);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(withdrawal(8).status).toBe('DONE');
  });

  it('records a deposit below the asset minimum without minting it, ever', async () => {
    seedState(10);
    eventsByBlock.set(11, [
      transferredToBridge('999'),
      transferredToBridge('1000'),
    ]);

    await startService(wrapperMetadata(), { minDepositAmount: '1000' });
    await head(11);
    await head(40);

    expect(mintCalls().map(([, , args]) => Number(String(args[2])))).toEqual([
      110001,
    ]);
    expect(mockContractQuery).toHaveBeenCalledTimes(1); // no dry-run for dust
    expect(deposit('11:0')).toMatchObject({
      status: 'MANUAL',
      amount: '999',
      depositRef: 110000,
      lastError: expect.stringMatching(/minimum/),
    });
    expect(deposit('11:1').status).toBe('DONE');
  });

  // --- R9: stop() lets the in-flight work finish -----------------------------

  it('stop() waits for the in-flight payout before saving and disconnecting', async () => {
    assetTransfer.mockImplementation(() => sendsAfter(30, succeeded()));
    seedState(10);
    eventsByBlock.set(11, [queued(12)]);

    const service = await startService();
    const api = mockChain.api as { disconnect: jest.Mock };
    let doneAtDisconnect: string | undefined;
    api.disconnect.mockImplementation(async () => {
      doneAtDisconnect = withdrawal(12).status;
    });
    const run = head(11);
    await waitFor(() => assetTransfer.mock.calls.length > 0, 'payout sent');

    await service.stop();

    expect(withdrawal(12).status).toBe('DONE');
    expect(doneAtDisconnect).toBe('DONE');
    expect(api.disconnect).toHaveBeenCalledTimes(1);
    await run;
  });

  it('a block that arrives after stop() is not processed', async () => {
    seedState(10);
    eventsByBlock.set(11, [transferredToBridge('500')]);

    const service = await startService();
    await service.stop();
    await head(11);

    expect(mintCalls()).toHaveLength(0);
    expect(readState().lastProcessedBlock).toBe(10);
  });

  // --- R5: accounts compared by id, not by SS58 string ----------------------

  const OTHER_CONTRACT = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
  const asLunes = (address: string) =>
    lunesRegistry.createType('AccountId', address).toString();

  it('mints once for a transfer whose recipient is the bridge account encoded with prefix 57', async () => {
    expect(asLunes(mockBridgeAddress)).not.toBe(mockBridgeAddress);
    seedState(10);
    eventsByBlock.set(11, [
      transferredTo(mockBridgeAddress, '500', lunesRegistry),
    ]);

    await startService();
    await head(11);

    expect(mintCalls()).toHaveLength(1);
    expect(Number(String(mintCalls()[0][2][2]))).toBe(110000);
    expect(deposit('11:0').status).toBe('DONE');
  });

  it('delivers once a WithdrawQueued whose wrapper address is prefix 57 while the config uses prefix 42', async () => {
    expect(asLunes(WRAPPER)).not.toBe(WRAPPER);
    mockContractTx.mockImplementation(
      (_address: string, method: string, args: unknown[]) => {
        if (method !== 'confirmWithdraw')
          throw new Error(`unexpected tx ${method}`);
        const id = Number(String(args[0]));
        return sends(
          succeeded([
            contractEmitted(
              WRAPPER,
              withdrawConfirmedPayload(id),
              lunesRegistry,
            ),
          ]),
        );
      },
    );
    seedState(10);
    eventsByBlock.set(11, [
      contractEmitted(
        WRAPPER,
        withdrawQueuedPayload(21, '1000'),
        lunesRegistry,
      ),
    ]);

    await startService();
    await head(11);

    expect(confirmCalls()).toHaveLength(1);
    expect(assetTransfer).toHaveBeenCalledTimes(1);
    expect(assetTransfer.mock.calls[0][0]).toBe(ASSET_ID);
    expect(String(assetTransfer.mock.calls[0][2])).toBe('1000');
    // state keys stay on the configured (prefix 42) wrapper address
    expect(readState().withdrawals[`${WRAPPER}:21`].status).toBe('DONE');
  });

  it.each([
    ['prefix 42', () => registry],
    ['prefix 57', () => lunesRegistry],
  ])(
    'still ignores a transfer to another account and an event from another contract (%s)',
    async (_label, chainRegistry) => {
      seedState(10);
      eventsByBlock.set(11, [
        transferredTo(ATTACKER, '500', chainRegistry()),
        contractEmitted(
          OTHER_CONTRACT,
          withdrawQueuedPayload(22, '1000'),
          chainRegistry(),
        ),
      ]);

      await startService();
      await head(11);

      expect(mockContractQuery).not.toHaveBeenCalled();
      expect(mockContractTx).not.toHaveBeenCalled();
      expect(assetTransfer).not.toHaveBeenCalled();
      expect(readState().deposits).toEqual({});
      expect(readState().withdrawals).toEqual({});
      expect(readState().lastProcessedBlock).toBe(11);
    },
  );
});

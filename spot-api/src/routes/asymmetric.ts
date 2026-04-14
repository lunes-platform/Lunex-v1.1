import fs from 'fs';
import path from 'path';
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { agentAuth } from '../middleware/agentAuth';
import {
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import {
  asymmetricService,
  type StrategyLiveCurveStateOutput,
  type StrategyLiveStateOutput,
} from '../services/asymmetricService';
import { rebalancerService } from '../services/rebalancerService';

// Expected code hash of the official AsymmetricPair contract.
// Set via env var ASYMMETRIC_PAIR_CODE_HASH after first compilation.
// If empty, validation is skipped (dev mode).
const EXPECTED_CODE_HASH = process.env.ASYMMETRIC_PAIR_CODE_HASH ?? '';

// Path to the compiled .contract bundle (wasm + metadata).
// Supports env var override for production deployments.
// Default: workspace target (cargo contract build output)
const CONTRACT_BUNDLE_PATH =
  process.env.ASYMMETRIC_CONTRACT_BUNDLE_PATH ??
  path.resolve(
    __dirname,
    '../../../target/ink/asymmetric_pair/asymmetric_pair.contract',
  );

const router = Router();

const SignedWalletActionSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

const SignedWalletReadSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

const ListStrategiesReadSchema = SignedWalletReadSchema.extend({
  address: z.string().min(8).max(128),
});

const StrategyReadSchema = SignedWalletReadSchema.extend({
  userAddress: z.string().min(8).max(128),
});

const StrategyLogsReadSchema = StrategyReadSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const CreateStrategySchema = z.object({
  userAddress: z.string().min(8).max(128),
  pairAddress: z.string().min(8).max(128),
  isAutoRebalance: z.coerce.boolean().optional().default(true),
  buyK: z.string().min(1),
  buyGamma: z.coerce.number().int().min(1).max(5),
  buyMaxCapacity: z.string().min(1),
  buyFeeTargetBps: z.coerce.number().int().min(0).max(1000).optional(),
  sellGamma: z.coerce.number().int().min(1).max(5),
  sellMaxCapacity: z.string().min(1),
  sellFeeTargetBps: z.coerce.number().int().min(0).max(1000).optional(),
  sellProfitTargetBps: z.coerce.number().int().min(0).max(100_000).optional(),
  leverageL: z.string().min(1).optional(),
  allocationC: z.coerce.number().min(0).max(1).optional(),
});

const CreateStrategySignedSchema = CreateStrategySchema.merge(
  SignedWalletActionSchema,
);

const UpdateCurveFieldsSchema = z.object({
  isBuySide: z.coerce.boolean(),
  newGamma: z.coerce.number().int().min(1).max(5).optional(),
  newMaxCapacity: z.string().min(1).optional(),
  newFeeTargetBps: z.coerce.number().int().min(0).max(1000).optional(),
});

const UpdateCurveSignedSchema = UpdateCurveFieldsSchema.extend({
  userAddress: z.string().min(8).max(128),
})
  .merge(SignedWalletActionSchema)
  .refine(
    (value) =>
      value.newGamma !== undefined ||
      value.newMaxCapacity !== undefined ||
      value.newFeeTargetBps !== undefined,
    { message: 'At least one curve parameter update is required' },
  );

const ToggleAutoSchema = z
  .object({
    userAddress: z.string().min(8).max(128),
    enable: z.coerce.boolean(),
  })
  .merge(SignedWalletActionSchema);

const AgentCreateStrategySchema = CreateStrategySchema.omit({
  userAddress: true,
});
const AgentUpdateCurveSchema = UpdateCurveFieldsSchema.extend({
  strategyId: z.string().uuid(),
}).refine(
  (value) =>
    value.newGamma !== undefined ||
    value.newMaxCapacity !== undefined ||
    value.newFeeTargetBps !== undefined,
  { message: 'At least one curve parameter update is required' },
);
const AgentLinkStrategySchema = z.object({
  strategyId: z.string().uuid(),
  pairAddress: z.string().min(8).max(128),
});

function send(res: Response, data: unknown, status = 200) {
  return res.status(status).json(data);
}

function mapAsymmetricError(err: unknown, res: Response): boolean {
  const message = err instanceof Error ? err.message : '';

  if (message === 'Strategy not found') {
    send(res, { error: message }, 404);
    return true;
  }

  if (
    message === 'Unauthorized' ||
    message === 'Strategy is not linked to the authenticated agent'
  ) {
    send(res, { error: message }, 403);
    return true;
  }

  if (
    message === 'Active strategy already exists for this pair' ||
    message === 'Strategy already linked to another agent' ||
    message === 'Pair address does not match the registered strategy' ||
    message === 'Relayer is not delegated as manager on this AsymmetricPair'
  ) {
    send(res, { error: message }, 409);
    return true;
  }

  if (
    message === 'buyGamma must be between 1 and 5' ||
    message === 'sellGamma must be between 1 and 5' ||
    message === 'buyK must be positive' ||
    message === 'gamma must be between 1 and 5'
  ) {
    send(res, { error: message }, 400);
    return true;
  }

  return false;
}

function handleAsync(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch((err) => {
      if (mapAsymmetricError(err, res)) return;
      next(err);
    });
}

async function validateOfficialAsymmetricContract(
  pairAddress: string,
  res: Response,
) {
  const isProd = process.env.NODE_ENV === 'production';

  if (!EXPECTED_CODE_HASH) {
    if (isProd) {
      send(
        res,
        {
          error:
            'ASYMMETRIC_PAIR_CODE_HASH is required in production to enforce official contract validation.',
        },
        503,
      );
      return false;
    }
    return true;
  }

  try {
    const { ApiPromise, WsProvider } = await import('@polkadot/api');
    const nodeUrl = process.env.LUNES_WS_URL ?? 'ws://127.0.0.1:9944';
    const api = await ApiPromise.create({
      provider: new WsProvider(nodeUrl),
      noInitWarn: true,
    });
    const info = await (api.query as any).contracts?.contractInfoOf(
      pairAddress,
    );
    await api.disconnect();
    const codeHash: string = info?.isSome
      ? (info.unwrap().codeHash?.toHex?.() ?? '')
      : '';

    if (!codeHash) {
      send(
        res,
        {
          error:
            'Unable to validate contract code hash for this pair. Only officially deployed AsymmetricPair contracts are allowed.',
        },
        403,
      );
      return false;
    }

    if (codeHash && codeHash !== EXPECTED_CODE_HASH) {
      send(
        res,
        {
          error:
            'Contract code hash does not match the official AsymmetricPair. Deploy using the Lunex interface.',
        },
        403,
      );
      return false;
    }
  } catch {
    if (isProd) {
      send(
        res,
        {
          error:
            'Contract validation is temporarily unavailable. Retry when chain connectivity is restored.',
        },
        503,
      );
      return false;
    }
  }

  return true;
}

function toLiveCurveState(curve: any): StrategyLiveCurveStateOutput | null {
  if (!curve) return null;
  return {
    k: Number(curve.k ?? 0),
    gamma: Number(curve.gamma ?? 0),
    maxCapacity: Number(curve.maxCapacity ?? 0),
    feeBps: Number(curve.feeBps ?? 0),
    currentVolume: Number(curve.currentVolume ?? 0),
  };
}

async function buildCanonicalStatusResponse(strategyId: string) {
  const strategy = await asymmetricService.getStrategy(strategyId);
  const checkedAt = new Date().toISOString();

  let buyCurve: StrategyLiveCurveStateOutput | null = null;
  let sellCurve: StrategyLiveCurveStateOutput | null = null;
  let managerAddress: string | null = null;
  let relayerAddress: string | null = null;
  let reason: string | null = null;

  const rebalancerEnabled = rebalancerService.isEnabled();

  if (!rebalancerEnabled) {
    reason = 'REBALANCER_DISABLED';
  } else {
    const [buyCurveRaw, sellCurveRaw, managerAddressRaw, relayerAddressRaw] =
      await Promise.all([
        rebalancerService.getCurveState(strategy.pairAddress, true),
        rebalancerService.getCurveState(strategy.pairAddress, false),
        rebalancerService.getManager(strategy.pairAddress),
        rebalancerService.getRelayerAddress(),
      ]);

    buyCurve = toLiveCurveState(buyCurveRaw);
    sellCurve = toLiveCurveState(sellCurveRaw);
    managerAddress = managerAddressRaw ?? null;
    relayerAddress = relayerAddressRaw ?? null;
    if (!buyCurve || !sellCurve) {
      reason = 'LIVE_CURVE_UNAVAILABLE';
    }
  }

  const delegatedToRelayer = Boolean(
    managerAddress && relayerAddress && managerAddress === relayerAddress,
  );
  const liveAvailable = Boolean(buyCurve && sellCurve);
  const liveState: StrategyLiveStateOutput = {
    available: liveAvailable,
    reason: liveAvailable ? null : reason ?? 'LIVE_STATE_UNAVAILABLE',
    source: liveAvailable ? 'on-chain' : 'unavailable',
    checkedAt,
    managerAddress,
    relayerAddress,
    delegatedToRelayer,
    buyCurve,
    sellCurve,
  };

  return asymmetricService.buildCanonicalStatus(strategy, {
    liveState,
    checkedAt,
  });
}

// ─── Routes ─────────────────────────────────────────────────────

router.get(
  '/contract-bundle',
  handleAsync(async (_req, res) => {
    if (!fs.existsSync(CONTRACT_BUNDLE_PATH)) {
      return send(
        res,
        {
          error:
            'Contract bundle not compiled yet. Run: cd Lunex/contracts/asymmetric_pair && cargo contract build --release',
          path: CONTRACT_BUNDLE_PATH,
        },
        503,
      );
    }
    const bundle = JSON.parse(fs.readFileSync(CONTRACT_BUNDLE_PATH, 'utf-8'));
    return send(res, bundle);
  }),
);

router.get(
  '/strategies',
  handleAsync(async (req, res) => {
    const parsed = ListStrategiesReadSchema.safeParse(req.query);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    const auth = await verifyWalletReadSignature({
      action: 'asymmetric.strategies.list',
      address: parsed.data.address,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
    });
    if (!auth.ok) return send(res, { error: auth.error }, 401);

    const strategies = await asymmetricService.listUserStrategies(
      parsed.data.address,
    );
    return send(res, strategies);
  }),
);

router.post(
  '/strategies',
  handleAsync(async (req, res) => {
    const parsed = CreateStrategySignedSchema.safeParse(req.body);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    const auth = await verifyWalletActionSignature({
      action: 'asymmetric.strategy.create',
      address: parsed.data.userAddress,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: {
        pairAddress: parsed.data.pairAddress,
        isAutoRebalance: parsed.data.isAutoRebalance,
        buyK: parsed.data.buyK,
        buyGamma: parsed.data.buyGamma,
        buyMaxCapacity: parsed.data.buyMaxCapacity,
        buyFeeTargetBps: parsed.data.buyFeeTargetBps,
        sellGamma: parsed.data.sellGamma,
        sellMaxCapacity: parsed.data.sellMaxCapacity,
        sellFeeTargetBps: parsed.data.sellFeeTargetBps,
        sellProfitTargetBps: parsed.data.sellProfitTargetBps,
        leverageL: parsed.data.leverageL,
        allocationC: parsed.data.allocationC,
      },
    });
    if (!auth.ok) return send(res, { error: auth.error }, 401);

    const validContract = await validateOfficialAsymmetricContract(
      parsed.data.pairAddress,
      res,
    );
    if (!validContract) return;

    const strategy = await asymmetricService.createStrategy({
      userAddress: parsed.data.userAddress,
      pairAddress: parsed.data.pairAddress,
      isAutoRebalance: parsed.data.isAutoRebalance,
      buyK: parsed.data.buyK,
      buyGamma: parsed.data.buyGamma,
      buyMaxCapacity: parsed.data.buyMaxCapacity,
      buyFeeTargetBps: parsed.data.buyFeeTargetBps,
      sellGamma: parsed.data.sellGamma,
      sellMaxCapacity: parsed.data.sellMaxCapacity,
      sellFeeTargetBps: parsed.data.sellFeeTargetBps,
      sellProfitTargetBps: parsed.data.sellProfitTargetBps,
      leverageL: parsed.data.leverageL,
      allocationC: parsed.data.allocationC,
    });

    return send(res, strategy, 201);
  }),
);

router.get(
  '/strategies/:id',
  handleAsync(async (req, res) => {
    const parsed = StrategyReadSchema.safeParse(req.query);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    const auth = await verifyWalletReadSignature({
      action: 'asymmetric.strategy.read',
      address: parsed.data.userAddress,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: { strategyId: req.params.id },
    });
    if (!auth.ok) return send(res, { error: auth.error }, 401);

    await asymmetricService.getStrategyForUser(
      req.params.id,
      parsed.data.userAddress,
    );
    const strategy = await buildCanonicalStatusResponse(req.params.id);
    return send(res, strategy);
  }),
);

router.patch(
  '/strategies/:id/auto',
  handleAsync(async (req, res) => {
    const parsed = ToggleAutoSchema.safeParse(req.body);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    const auth = await verifyWalletActionSignature({
      action: 'asymmetric.strategy.toggle-auto',
      address: parsed.data.userAddress,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: {
        strategyId: req.params.id,
        enable: parsed.data.enable,
      },
    });
    if (!auth.ok) return send(res, { error: auth.error }, 401);

    const strategy = await asymmetricService.toggleAutoRebalance(
      req.params.id,
      parsed.data.userAddress,
      parsed.data.enable,
    );

    return send(res, strategy);
  }),
);

router.patch(
  '/strategies/:id/curve',
  handleAsync(async (req, res) => {
    const parsed = UpdateCurveSignedSchema.safeParse(req.body);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    const auth = await verifyWalletActionSignature({
      action: 'asymmetric.strategy.update-curve',
      address: parsed.data.userAddress,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: {
        strategyId: req.params.id,
        isBuySide: parsed.data.isBuySide,
        newGamma: parsed.data.newGamma,
        newMaxCapacity: parsed.data.newMaxCapacity,
        newFeeTargetBps: parsed.data.newFeeTargetBps,
      },
    });
    if (!auth.ok) return send(res, { error: auth.error }, 401);

    const strategy = await asymmetricService.updateCurveParams(
      req.params.id,
      parsed.data.userAddress,
      {
        isBuySide: parsed.data.isBuySide,
        newGamma: parsed.data.newGamma,
        newMaxCapacity: parsed.data.newMaxCapacity,
        newFeeTargetBps: parsed.data.newFeeTargetBps,
      },
    );

    return send(res, strategy);
  }),
);

router.get(
  '/strategies/:id/logs',
  handleAsync(async (req, res) => {
    const parsed = StrategyLogsReadSchema.safeParse(req.query);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    const auth = await verifyWalletReadSignature({
      action: 'asymmetric.strategy.logs',
      address: parsed.data.userAddress,
      nonce: parsed.data.nonce,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      fields: { strategyId: req.params.id, limit: parsed.data.limit ?? 50 },
    });
    if (!auth.ok) return send(res, { error: auth.error }, 401);

    await asymmetricService.getStrategyForUser(
      req.params.id,
      parsed.data.userAddress,
    );
    const limit = parsed.data.limit ?? 50;
    const logs = await asymmetricService.getRebalanceLogs(req.params.id, limit);
    return send(res, logs);
  }),
);

// ─── MCP Agent Tool Endpoints ────────────────────────────────────

router.get(
  '/agent/delegation-context',
  agentAuth(['MANAGE_ASYMMETRIC']),
  handleAsync(async (req, res) => {
    const relayerAddress = await rebalancerService.getRelayerAddress();
    if (!relayerAddress) {
      return send(
        res,
        {
          error:
            'RELAYER_SEED is not configured for asymmetric manager delegation',
        },
        503,
      );
    }

    return send(res, {
      relayerAddress,
      authenticatedAgentId: req.agent!.id,
      walletAddress: req.agent!.walletAddress,
    });
  }),
);

router.post(
  '/agent/link-strategy',
  agentAuth(['MANAGE_ASYMMETRIC']),
  handleAsync(async (req, res) => {
    const parsed = AgentLinkStrategySchema.safeParse(req.body);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    const delegated = await rebalancerService.isManagedByRelayer(
      parsed.data.pairAddress,
    );
    if (!delegated) {
      return send(
        res,
        {
          error:
            'On-chain manager delegation is incomplete. Apply set_manager to the relayer before linking the strategy.',
        },
        409,
      );
    }

    const strategy = await asymmetricService.linkStrategyToAgent(
      parsed.data.strategyId,
      req.agent!.id,
      req.agent!.walletAddress,
      parsed.data.pairAddress,
    );

    return send(res, { success: true, strategy }, 201);
  }),
);

router.post(
  '/agent/create-strategy',
  agentAuth(['MANAGE_ASYMMETRIC']),
  handleAsync(async (req, res) => {
    const parsed = AgentCreateStrategySchema.safeParse(req.body);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    const validContract = await validateOfficialAsymmetricContract(
      parsed.data.pairAddress,
      res,
    );
    if (!validContract) return;

    const strategy = await asymmetricService.createStrategy({
      userAddress: req.agent!.walletAddress,
      pairAddress: parsed.data.pairAddress,
      agentId: req.agent!.id,
      isAutoRebalance: parsed.data.isAutoRebalance,
      buyK: parsed.data.buyK,
      buyGamma: parsed.data.buyGamma,
      buyMaxCapacity: parsed.data.buyMaxCapacity,
      buyFeeTargetBps: parsed.data.buyFeeTargetBps,
      sellGamma: parsed.data.sellGamma,
      sellMaxCapacity: parsed.data.sellMaxCapacity,
      sellFeeTargetBps: parsed.data.sellFeeTargetBps,
      sellProfitTargetBps: parsed.data.sellProfitTargetBps,
      leverageL: parsed.data.leverageL,
      allocationC: parsed.data.allocationC,
    });

    return send(
      res,
      {
        tool: 'agent_create_asymmetric_strategy',
        success: true,
        strategy,
      },
      201,
    );
  }),
);

router.post(
  '/agent/update-curve',
  agentAuth(['MANAGE_ASYMMETRIC']),
  handleAsync(async (req, res) => {
    const parsed = AgentUpdateCurveSchema.safeParse(req.body);
    if (!parsed.success) {
      return send(
        res,
        { error: 'Validation failed', details: parsed.error.issues },
        400,
      );
    }

    await asymmetricService.getStrategyForAgent(
      parsed.data.strategyId,
      req.agent!.id,
      req.agent!.walletAddress,
    );

    const result = await rebalancerService.executeAgentCurveUpdate(
      parsed.data.strategyId,
      {
        isBuySide: parsed.data.isBuySide,
        newGamma: parsed.data.newGamma,
        newMaxCapacity: parsed.data.newMaxCapacity,
        newFeeTargetBps: parsed.data.newFeeTargetBps,
      },
    );

    return send(res, {
      tool: 'agent_update_curve_parameters',
      success: true,
      strategy: result.strategy,
      txHash: result.txHash,
    });
  }),
);

router.get(
  '/agent/strategy-status/:id',
  agentAuth(['MANAGE_ASYMMETRIC']),
  handleAsync(async (req, res) => {
    await asymmetricService.getStrategyForAgent(
      req.params.id,
      req.agent!.id,
      req.agent!.walletAddress,
    );

    const strategy = await buildCanonicalStatusResponse(req.params.id);
    const logs = await asymmetricService.getRebalanceLogs(req.params.id, 10);

    return send(res, {
      tool: 'agent_get_strategy_status',
      success: true,
      strategy,
      recentLogs: logs,
    });
  }),
);

export default router;

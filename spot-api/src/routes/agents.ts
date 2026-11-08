import { NextFunction, Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { agentService } from '../services/agentService';
import { agentAuth, optionalAgentAuth } from '../middleware/agentAuth';
import {
  getSignedAuthInput,
  verifyWalletActionSignature,
  verifyWalletReadSignature,
} from '../middleware/auth';
import {
  readAuthSchema,
  verifyWalletReadAccess,
} from '../middleware/readSession';
import { requireAdmin } from '../middleware/adminGuard';

const router = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const RegisterAgentSchema = z.object({
  walletAddress: z.string().min(8).max(128),
  agentType: z.enum(['HUMAN', 'AI_AGENT', 'OPENCLAW_BOT', 'ALGO_BOT']),
  framework: z.string().max(64).optional(),
  strategyDescription: z.string().max(2000).optional(),
  linkLeaderId: z.string().uuid().optional(),
});

const SignedWalletActionSchema = z.object({
  nonce: z.string().min(8),
  timestamp: z.coerce.number().int().positive(),
  signature: z.string().min(8),
});

const RegisterAgentSignedSchema = RegisterAgentSchema.merge(
  SignedWalletActionSchema,
);

const CreateApiKeySchema = z.object({
  label: z.string().max(64).optional(),
  permissions: z
    .array(
      z.enum([
        'TRADE_SPOT',
        'TRADE_MARGIN',
        'SOCIAL_POST',
        'COPYTRADE_SIGNAL',
        'READ_ONLY',
        'MANAGE_ASYMMETRIC',
      ]),
    )
    .min(1),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

const CreateApiKeyBootstrapSchema = CreateApiKeySchema.extend({
  walletAddress: z.string().min(8).max(128),
}).merge(SignedWalletActionSchema);

// BE-13: owner-wallet signed key management (works even when an attacker
// holds a leaked API key — no API key is accepted on these routes).
const WalletRevokeAllSchema = z
  .object({ walletAddress: z.string().min(8).max(128) })
  .merge(SignedWalletActionSchema);

const WalletRotateApiKeySchema = CreateApiKeyBootstrapSchema;

const RecordStakeSchema = z.object({
  amount: z.coerce.number().positive(),
  token: z.string().max(32).optional(),
  txHash: z.string().min(1).max(128), // required — on-chain proof
});

const ListAgentsSchema = z.object({
  agentType: z
    .enum(['HUMAN', 'AI_AGENT', 'OPENCLAW_BOT', 'ALGO_BOT'])
    .optional(),
  isActive: z.coerce.boolean().optional(),
  sortBy: z
    .enum(['totalTrades', 'totalVolume', 'stakedAmount', 'createdAt'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────

function ensureAgentScope(req: Request, res: Response) {
  if (!req.agent) {
    res.status(401).json({ error: 'Missing authenticated agent context' });
    return false;
  }
  if (req.agent.id !== req.params.id) {
    res
      .status(403)
      .json({ error: 'Authenticated agent does not match target agent' });
    return false;
  }
  return true;
}

function hasPermissionSubset(
  requested: z.infer<typeof CreateApiKeySchema>['permissions'],
  granted: NonNullable<Request['agent']>['permissions'],
) {
  const grantedPermissions = new Set(granted);
  return requested.every((permission) => grantedPermissions.has(permission));
}

// ─── Public Routes ───────────────────────────────────────────────

router.post(
  '/register',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RegisterAgentSignedSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletActionSignature({
        action: 'agents.register',
        address: parsed.data.walletAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          agentType: parsed.data.agentType,
          framework: parsed.data.framework,
          strategyDescription: parsed.data.strategyDescription,
          linkLeaderId: parsed.data.linkLeaderId,
        },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const agent = await agentService.registerAgent(parsed.data);
      res.status(201).json({ agent });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ListAgentsSchema.safeParse(req.query);
    const filters = parsed.success ? parsed.data : {};
    const result = await agentService.listAgents(filters);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/config/staking-tiers', (_req: Request, res: Response) => {
  res.json({ tiers: agentService.STAKING_TIERS });
});

router.get(
  '/by-wallet/:address',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = readAuthSchema(req, SignedWalletActionSchema).safeParse({
        ...req.query,
        ...getSignedAuthInput(req),
      });
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const auth = await verifyWalletReadAccess(req, {
        action: 'agents.by-wallet',
        address: req.params.address,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const agent = await agentService.getAgentByWallet(req.params.address);
      if (!agent)
        return res
          .status(404)
          .json({ error: 'Agent not found for this wallet' });
      res.json({ agent });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/me',
  agentAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = await agentService.getAgentProfile(req.agent!.id);
      res.json({ agent });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // BE-11: public view, no owner wallet.
    const agent = await agentService.getPublicAgentProfile(req.params.id);
    res.json({ agent });
  } catch (err) {
    next(err);
  }
});

// ─── Authenticated Routes ────────────────────────────────────────

router.post(
  '/:id/api-keys',
  optionalAgentAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      let parsedData: z.infer<typeof CreateApiKeySchema>;
      let maxExpiresAt: Date | undefined;

      if (req.agent) {
        if (!ensureAgentScope(req, res)) return;
        const parsed = CreateApiKeySchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: 'Validation failed', details: parsed.error.issues });
        }
        if (
          !hasPermissionSubset(parsed.data.permissions, req.agent.permissions)
        ) {
          return res.status(403).json({
            error:
              'Cannot create API key with permissions outside authenticated key scope',
          });
        }
        // BE-13: a child key never outlives the key that minted it.
        const parentKey = (await agentService.getApiKeys(req.params.id)).find(
          (key) => key.id === req.agent!.keyId,
        );
        if (!parentKey) {
          return res
            .status(401)
            .json({ error: 'Authenticated API key not found' });
        }
        maxExpiresAt = new Date(parentKey.expiresAt);
        parsedData = parsed.data;
      } else {
        const parsed = CreateApiKeyBootstrapSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(401).json({
            error:
              'Creating the first API key requires either X-API-Key or walletAddress, nonce, timestamp, and signature',
          });
        }
        const agent = await agentService.getAgentProfile(req.params.id);
        if (agent.walletAddress !== parsed.data.walletAddress) {
          return res
            .status(403)
            .json({ error: 'Wallet signature does not match target agent' });
        }
        const existingKeys = await agentService.getApiKeys(req.params.id);
        if (existingKeys.some((key) => key.isActive)) {
          return res.status(403).json({
            error:
              'Existing API keys require authenticated agent key management',
            hint: 'The owner wallet can sign POST /agents/:id/api-keys/rotate or /revoke-all',
          });
        }
        const auth = await verifyWalletActionSignature({
          action: 'agents.create-api-key',
          address: parsed.data.walletAddress,
          nonce: parsed.data.nonce,
          timestamp: parsed.data.timestamp,
          signature: parsed.data.signature,
          fields: {
            agentId: req.params.id,
            label: parsed.data.label,
            permissions: parsed.data.permissions,
            expiresInDays: parsed.data.expiresInDays,
          },
        });
        if (!auth.ok) return res.status(401).json({ error: auth.error });
        parsedData = parsed.data;
      }

      const result = await agentService.createApiKey(
        req.params.id,
        parsedData,
        { maxExpiresAt },
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * BE-13 — emergency revoke, signed by the agent's OWNER WALLET. Works while a
 * leaked key is still active (no API key is involved), so the owner can
 * always lock an attacker out.
 */
router.post(
  '/:id/api-keys/revoke-all',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = WalletRevokeAllSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const agent = await agentService.getAgentProfile(req.params.id);
      if (agent.walletAddress !== parsed.data.walletAddress) {
        return res
          .status(403)
          .json({ error: 'Wallet signature does not match target agent' });
      }
      const auth = await verifyWalletActionSignature({
        action: 'agents.revoke-all-api-keys',
        address: parsed.data.walletAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: { agentId: req.params.id },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await agentService.revokeAllApiKeys(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * BE-13 — rotation signed by the OWNER WALLET: revokes every key, then issues
 * a single new one (returned once).
 */
router.post(
  '/:id/api-keys/rotate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = WalletRotateApiKeySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const agent = await agentService.getAgentProfile(req.params.id);
      if (agent.walletAddress !== parsed.data.walletAddress) {
        return res
          .status(403)
          .json({ error: 'Wallet signature does not match target agent' });
      }
      const auth = await verifyWalletActionSignature({
        action: 'agents.rotate-api-key',
        address: parsed.data.walletAddress,
        nonce: parsed.data.nonce,
        timestamp: parsed.data.timestamp,
        signature: parsed.data.signature,
        fields: {
          agentId: req.params.id,
          label: parsed.data.label,
          permissions: parsed.data.permissions,
          expiresInDays: parsed.data.expiresInDays,
        },
      });
      if (!auth.ok) return res.status(401).json({ error: auth.error });

      const result = await agentService.rotateApiKey(req.params.id, {
        label: parsed.data.label,
        permissions: parsed.data.permissions,
        expiresInDays: parsed.data.expiresInDays,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/:id/api-keys/:keyId',
  agentAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!ensureAgentScope(req, res)) return;
      await agentService.revokeApiKey(req.params.id, req.params.keyId, {
        actorKeyId: req.agent!.keyId,
        actorPermissions: req.agent!.permissions,
      });
      res.json({ revoked: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:id/api-keys',
  agentAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!ensureAgentScope(req, res)) return;
      const keys = await agentService.getApiKeys(req.params.id);
      res.json({ keys });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:id/stake',
  agentAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!ensureAgentScope(req, res)) return;
      const parsed = RecordStakeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.issues });
      }
      const result = await agentService.recordStake(req.params.id, parsed.data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// Admin-only: confirm a stake after on-chain verification
// POST /agents/:id/stakes/:stakeId/verify  — requires ADMIN_SECRET bearer token
router.post(
  '/:id/stakes/:stakeId/verify',
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await agentService.verifyStake(req.params.stakeId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:id/permissions',
  agentAuth(),
  async (req: Request, res: Response) => {
    if (!ensureAgentScope(req, res)) return;
    res.json({
      agentId: req.agent!.id,
      permissions: req.agent!.permissions,
      stakingTier: req.agent!.stakingTier,
      tradingLimits: {
        dailyTradeLimit: req.agent!.dailyTradeLimit,
        maxPositionSize: req.agent!.maxPositionSize,
        maxOpenOrders: req.agent!.maxOpenOrders,
      },
    });
  },
);

export default router;

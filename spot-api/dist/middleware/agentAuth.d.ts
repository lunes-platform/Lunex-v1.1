import type { Request, Response, NextFunction } from 'express';
import type { AgentApiKeyPermission } from '@prisma/client';
declare global {
    namespace Express {
        interface Request {
            agent?: {
                id: string;
                walletAddress: string;
                agentType: string;
                permissions: AgentApiKeyPermission[];
                keyId: string;
                stakingTier: number;
                dailyTradeLimit: number;
                maxPositionSize: number;
                maxOpenOrders: number;
            };
        }
    }
}
/**
 * Middleware that verifies API key from X-API-Key header.
 * Attaches agent context to req.agent if valid.
 */
export declare function agentAuth(requiredPermissions?: AgentApiKeyPermission[]): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Optional agent auth — does not reject if no API key is present.
 * Useful for routes that support both wallet and API key auth.
 */
export declare function optionalAgentAuth(): (req: Request, _res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=agentAuth.d.ts.map
/**
 * Pagination middleware — enforces max limit and provides defaults.
 * Attaches req.pagination = { page, limit, skip }
 */
import { Request, Response, NextFunction } from 'express';
export interface Pagination {
    page: number;
    limit: number;
    skip: number;
}
declare global {
    namespace Express {
        interface Request {
            pagination?: Pagination;
        }
    }
}
export declare function paginationMiddleware(): (req: Request, _res: Response, next: NextFunction) => void;
/** Helper for Prisma queries */
export declare function paginateQuery(req: Request): {
    take: number;
    skip: number;
};
//# sourceMappingURL=pagination.d.ts.map
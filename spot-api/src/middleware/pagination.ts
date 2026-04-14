/**
 * Pagination middleware — enforces max limit and provides defaults.
 * Attaches req.pagination = { page, limit, skip }
 */
import { Request, Response, NextFunction } from 'express';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE = 1;

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

export function paginationMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const page = Math.max(
      1,
      parseInt(req.query.page as string) || DEFAULT_PAGE,
    );
    const rawLimit = parseInt(req.query.limit as string) || DEFAULT_LIMIT;
    const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
    const skip = (page - 1) * limit;

    req.pagination = { page, limit, skip };
    next();
  };
}

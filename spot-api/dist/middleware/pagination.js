"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginationMiddleware = paginationMiddleware;
exports.paginateQuery = paginateQuery;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE = 1;
function paginationMiddleware() {
    return (req, _res, next) => {
        const page = Math.max(1, parseInt(req.query.page) || DEFAULT_PAGE);
        const rawLimit = parseInt(req.query.limit) || DEFAULT_LIMIT;
        const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
        const skip = (page - 1) * limit;
        req.pagination = { page, limit, skip };
        next();
    };
}
/** Helper for Prisma queries */
function paginateQuery(req) {
    const { limit, skip } = req.pagination || { limit: DEFAULT_LIMIT, skip: 0 };
    return { take: limit, skip };
}
//# sourceMappingURL=pagination.js.map
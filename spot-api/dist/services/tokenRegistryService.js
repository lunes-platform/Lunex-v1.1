"use strict";
/**
 * Token Registry Service
 *
 * Unified, trusted token metadata. Auto-populated when listings are
 * activated. Supports manual admin entries for seed tokens (LUNES, USDT).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToken = registerToken;
exports.getToken = getToken;
exports.getAllTokens = getAllTokens;
exports.searchTokens = searchTokens;
exports.deleteToken = deleteToken;
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../utils/logger");
async function registerToken(input) {
    const existing = await db_1.default.tokenRegistry.findUnique({
        where: { address: input.address },
    });
    if (existing) {
        const updated = await db_1.default.tokenRegistry.update({
            where: { address: input.address },
            data: {
                symbol: input.symbol,
                name: input.name,
                decimals: input.decimals ?? existing.decimals,
                logoURI: input.logoURI ?? existing.logoURI,
                isVerified: input.isVerified ?? existing.isVerified,
                isTrusted: input.isTrusted ?? existing.isTrusted,
                source: input.source ?? existing.source,
                listingId: input.listingId ?? existing.listingId,
            },
        });
        logger_1.log.info({ address: input.address }, '[TokenRegistry] Updated');
        return updated;
    }
    const token = await db_1.default.tokenRegistry.create({
        data: {
            address: input.address,
            symbol: input.symbol,
            name: input.name,
            decimals: input.decimals ?? 18,
            logoURI: input.logoURI ?? null,
            isVerified: input.isVerified ?? false,
            isTrusted: input.isTrusted ?? false,
            source: input.source ?? 'LISTING',
            listingId: input.listingId ?? null,
        },
    });
    logger_1.log.info({ address: input.address, symbol: input.symbol }, '[TokenRegistry] Registered');
    return token;
}
async function getToken(address) {
    return db_1.default.tokenRegistry.findUnique({ where: { address } });
}
async function getAllTokens(params) {
    return db_1.default.tokenRegistry.findMany({
        where: {
            ...(params?.verified !== undefined ? { isVerified: params.verified } : {}),
            ...(params?.trusted !== undefined ? { isTrusted: params.trusted } : {}),
        },
        orderBy: { symbol: 'asc' },
    });
}
async function searchTokens(query) {
    const q = query.trim();
    if (!q)
        return [];
    return db_1.default.tokenRegistry.findMany({
        where: {
            OR: [
                { symbol: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
                { address: q },
            ],
        },
        orderBy: { symbol: 'asc' },
        take: 20,
    });
}
async function deleteToken(address) {
    return db_1.default.tokenRegistry.delete({ where: { address } });
}
//# sourceMappingURL=tokenRegistryService.js.map
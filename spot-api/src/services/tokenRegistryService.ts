/**
 * Token Registry Service
 *
 * Unified, trusted token metadata. Auto-populated when listings are
 * activated. Supports manual admin entries for seed tokens (LUNES, USDT).
 */

import prisma from '../db'
import { log } from '../utils/logger'

export type RegisterTokenInput = {
  address:    string
  symbol:     string
  name:       string
  decimals?:  number
  logoURI?:   string
  isVerified?: boolean
  isTrusted?:  boolean
  source?:    string
  listingId?: string
}

export async function registerToken(input: RegisterTokenInput) {
  const existing = await prisma.tokenRegistry.findUnique({
    where: { address: input.address },
  })

  if (existing) {
    const updated = await prisma.tokenRegistry.update({
      where: { address: input.address },
      data: {
        symbol:     input.symbol,
        name:       input.name,
        decimals:   input.decimals ?? existing.decimals,
        logoURI:    input.logoURI ?? existing.logoURI,
        isVerified: input.isVerified ?? existing.isVerified,
        isTrusted:  input.isTrusted ?? existing.isTrusted,
        source:     input.source ?? existing.source,
        listingId:  input.listingId ?? existing.listingId,
      },
    })
    log.info({ address: input.address }, '[TokenRegistry] Updated')
    return updated
  }

  const token = await prisma.tokenRegistry.create({
    data: {
      address:    input.address,
      symbol:     input.symbol,
      name:       input.name,
      decimals:   input.decimals ?? 18,
      logoURI:    input.logoURI ?? null,
      isVerified: input.isVerified ?? false,
      isTrusted:  input.isTrusted ?? false,
      source:     input.source ?? 'LISTING',
      listingId:  input.listingId ?? null,
    },
  })
  log.info({ address: input.address, symbol: input.symbol }, '[TokenRegistry] Registered')
  return token
}

export async function getToken(address: string) {
  return prisma.tokenRegistry.findUnique({ where: { address } })
}

export async function getAllTokens(params?: { verified?: boolean; trusted?: boolean }) {
  return prisma.tokenRegistry.findMany({
    where: {
      ...(params?.verified !== undefined ? { isVerified: params.verified } : {}),
      ...(params?.trusted  !== undefined ? { isTrusted: params.trusted }   : {}),
    },
    orderBy: { symbol: 'asc' },
  })
}

export async function searchTokens(query: string) {
  const q = query.trim()
  if (!q) return []
  return prisma.tokenRegistry.findMany({
    where: {
      OR: [
        { symbol: { contains: q, mode: 'insensitive' } },
        { name:   { contains: q, mode: 'insensitive' } },
        { address: q },
      ],
    },
    orderBy: { symbol: 'asc' },
    take: 20,
  })
}

export async function deleteToken(address: string) {
  return prisma.tokenRegistry.delete({ where: { address } })
}

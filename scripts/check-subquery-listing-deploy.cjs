#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const errors = []

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function requireFile(relPath) {
  if (!fs.existsSync(path.join(root, relPath))) {
    errors.push(`Missing required file: ${relPath}`)
    return false
  }
  return true
}

function requireText(relPath, pattern, message) {
  if (!requireFile(relPath)) return
  const text = read(relPath)
  if (pattern instanceof RegExp ? !pattern.test(text) : !text.includes(pattern)) {
    errors.push(`${relPath}: ${message}`)
  }
}

requireText(
  'subquery-node/schema.graphql',
  /listingId:\s+BigInt\s+@index/,
  'ListingEvent.listingId must be indexed for proof verification/backfill queries',
)
requireText(
  'subquery-node/schema.graphql',
  /lockId:\s+BigInt\s+@index/,
  'ListingEvent.lockId must be indexed for proof verification/backfill queries',
)
requireText(
  'subquery-node/src/mappings/listing.ts',
  'args.listing_id',
  'TokenListed mapping must persist listing_id',
)
requireText(
  'subquery-node/src/mappings/listing.ts',
  'args.lock_id',
  'Listing mappings must persist lock_id',
)
requireText(
  'subquery-node/src/types/models/ListingEvent.ts',
  'getByListingId',
  'SubQuery codegen must be regenerated after adding listingId',
)
requireText(
  'subquery-node/src/types/models/ListingEvent.ts',
  'getByLockId',
  'SubQuery codegen must be regenerated after adding lockId',
)

for (const handler of [
  'handleTokenListed',
  'handleLiquidityLocked',
  'handleLiquidityUnlocked',
]) {
  requireText(
    'subquery-node/project.template.yaml',
    handler,
    `project template must register ${handler}`,
  )
}

requireText(
  'docker/docker-compose.prod.yml',
  '--unfinalized-blocks=false',
  'production SubQuery must index finalized blocks only for listing proof semantics',
)
requireText(
  'docker/docker-compose.prod.yml',
  /SUBQUERY_ENDPOINT:\s*['"]?http:\/\/subquery-query:3000['"]?/,
  'spot-api must point at the internal SubQuery query service',
)
requireText(
  'docker/docker-compose.prod.yml',
  /SUBQUERY_ENABLED:\s*['"]true['"]/,
  'spot-api must enable SubQuery in production',
)
requireText(
  'docker/docker-compose.prod.yml',
  'listing-relayer:',
  'production compose must include listing-relayer service',
)
requireText(
  'docker/docker-compose.prod.yml',
  'subquery-query:',
  'listing-relayer must wait for subquery-query service',
)

requireText(
  'docker/.env.prod.example',
  /^LUNES_START_BLOCK=/m,
  'production env example must expose LUNES_START_BLOCK for backfill control',
)
requireText(
  'docker/.env.prod.example',
  /^LISTING_RELAYER_START_BLOCK=/m,
  'production env example must expose LISTING_RELAYER_START_BLOCK for safe replay',
)

requireFile('docs/runbooks/subquery-backfill.md')
requireText(
  'docs/runbooks/subquery-backfill.md',
  '## Rollback',
  'SubQuery backfill runbook must include rollback instructions',
)

if (errors.length > 0) {
  console.error('SubQuery listing deploy check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('SubQuery listing deploy check passed')

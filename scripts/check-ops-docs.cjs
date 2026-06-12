#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const alertFile = path.join(root, 'docker', 'alert-rules.yml')
const runbooksDir = path.join(root, 'docs', 'runbooks')
const requiredFiles = [
  'SECURITY.md',
  path.join('docs', 'THREAT_MODEL.md'),
  path.join('docs', 'runbooks', 'api-down.md'),
  path.join('docs', 'runbooks', 'blockchain-down.md'),
  path.join('docs', 'runbooks', 'database.md'),
  path.join('docs', 'runbooks', 'redis.md'),
  path.join('docs', 'runbooks', 'security-alerts.md')
]

const errors = []

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    errors.push(`Missing required ops/security document: ${file}`)
  }
}

const alerts = fs.readFileSync(alertFile, 'utf8')
if (alerts.includes('your-org')) {
  errors.push('docker/alert-rules.yml still contains your-org placeholder')
}

const runbookMatches = [
  ...alerts.matchAll(/runbook:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/g)
].map((match) => match[1] || match[2] || match[3])
if (runbookMatches.length === 0) {
  errors.push('docker/alert-rules.yml has no runbook annotations')
}

for (const ref of runbookMatches) {
  if (!ref.startsWith('docs/runbooks/')) {
    errors.push(`Runbook annotation must use local docs/runbooks path: ${ref}`)
    continue
  }
  const file = path.join(root, ref)
  if (!fs.existsSync(file)) {
    errors.push(`Runbook annotation points to missing file: ${ref}`)
  }
}

if (fs.existsSync(runbooksDir)) {
  for (const file of fs.readdirSync(runbooksDir)) {
    if (!file.endsWith('.md')) continue
    const full = path.join(runbooksDir, file)
    const text = fs.readFileSync(full, 'utf8')
    for (const heading of ['## Impact', '## Triage', '## Mitigation']) {
      if (!text.includes(heading)) {
        errors.push(`Runbook ${path.join('docs/runbooks', file)} missing ${heading}`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Ops docs guard failed:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Ops docs guard passed')

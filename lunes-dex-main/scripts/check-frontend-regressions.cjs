#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const srcDir = path.join(root, 'src')

const sourceExtensions = new Set(['.ts', '.tsx'])
const skippedParts = new Set(['abis'])
const skippedFiles = new Set([path.join('pages', 'docs', 'index.tsx')])

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!skippedParts.has(entry.name)) {
        walk(full, files)
      }
      continue
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(full)
    }
  }
  return files
}

function rel(file) {
  return path.relative(srcDir, file)
}

function isSkipped(file) {
  return skippedFiles.has(rel(file))
}

function findUseEffectBodies(source) {
  const bodies = []
  let index = 0
  const needle = 'useEffect('

  while ((index = source.indexOf(needle, index)) !== -1) {
    const start = index
    let cursor = index + needle.length
    let depth = 1
    let quote = null
    let escaped = false

    while (cursor < source.length && depth > 0) {
      const ch = source[cursor]

      if (quote) {
        if (escaped) {
          escaped = false
        } else if (ch === '\\') {
          escaped = true
        } else if (ch === quote) {
          quote = null
        }
        cursor += 1
        continue
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
      } else if (ch === '(') {
        depth += 1
      } else if (ch === ')') {
        depth -= 1
      }
      cursor += 1
    }

    bodies.push({ start, body: source.slice(start, cursor) })
    index = cursor
  }

  return bodies
}

const files = walk(srcDir).filter(file => !isSkipped(file))
const violations = []

const envAddressFallback =
  /process\.env\.REACT_APP_(?:TOKEN_[A-Z0-9_]+|[A-Z0-9_]*CONTRACT)\s*\|\|\s*['"]5[1-9A-HJ-NP-Za-km-z]{46,}['"]/g

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = rel(file)

  for (const match of source.matchAll(envAddressFallback)) {
    violations.push(
      `${relative}: hardcoded contract/token address fallback near offset ${match.index}`
    )
  }

  for (const effect of findUseEffectBodies(source)) {
    if (
      /\bsignMessage\s*\(/.test(effect.body) ||
      /\bsignRaw\s*\(/.test(effect.body)
    ) {
      violations.push(
        `${relative}: wallet signing call inside useEffect near offset ${effect.start}`
      )
    }
    if (
      /\bsignMessage\b/.test(effect.body) &&
      /get[A-Za-z0-9_]*\(/.test(effect.body)
    ) {
      violations.push(
        `${relative}: signed read dependency inside useEffect near offset ${effect.start}`
      )
    }
  }
}

if (violations.length > 0) {
  console.error('Frontend regression guard failed:')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('Frontend regression guard passed')

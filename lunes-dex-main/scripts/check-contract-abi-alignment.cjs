#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const src = path.join(root, 'src')

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

function snakeToCamel(label) {
  return label.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase())
}

function loadAbiMethods(file) {
  const abi = JSON.parse(read(file))
  return new Set(
    (abi.spec?.messages ?? []).flatMap(message => [
      message.label,
      snakeToCamel(message.label)
    ])
  )
}

function listSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (!/\.(ts|tsx)$/.test(entry.name)) return []
    return [fullPath]
  })
}

function listFiles(dir, pattern) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(fullPath, pattern)
    return pattern.test(entry.name) ? [fullPath] : []
  })
}

function stripLiteralsAndComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`\\])*`/gs, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
}

const abiMethods = new Set()
for (const abiFile of listFiles(path.join(src, 'abis'), /\.json$/)) {
  const rel = path.relative(root, abiFile)
  for (const method of loadAbiMethods(rel)) {
    abiMethods.add(method)
  }
}

const failures = []
const methodCallPattern =
  /\.(?:query|tx)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g

for (const filePath of listSourceFiles(src)) {
  const rel = path.relative(root, filePath)
  const content = fs.readFileSync(filePath, 'utf8')
  const executableContent = stripLiteralsAndComments(content)

  for (const match of executableContent.matchAll(methodCallPattern)) {
    const method = match[1]
    if (!abiMethods.has(method)) {
      failures.push(
        `${rel} calls ${method}(), but no imported ABI exposes that message`
      )
    }
  }

  if (/address:\s*['"]native['"]/.test(content)) {
    failures.push(
      `${rel} exposes address: 'native'. Use the WLUNES contract address until native LUNES routes are fully implemented.`
    )
  }

  if (
    /READ_SIGNATURE_TTL_MS|readAuthCache|readSignatureCache|expiresAt:\s*Date\.now\(\)\s*\+/.test(
      content
    )
  ) {
    failures.push(
      `${rel} caches signed read auth. Signed reads must use a fresh nonce/signature per request.`
    )
  }
}

if (failures.length > 0) {
  console.error('Contract/ABI alignment check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Contract/ABI alignment check passed')

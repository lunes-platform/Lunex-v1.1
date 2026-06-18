/**
 * Cross-contract call audit.
 *
 * For every manual `build_call`/`Ref` cross-contract call in the ink! contracts,
 * compute the real 4-byte selector (blake2_256(name)[0..4]) and count its
 * push_arg arguments, then check both against the union of all contract ABIs.
 *
 * Flags the bug class found in WNativeRef::transfer:
 *  - DANGLING SELECTOR: no ABI message anywhere has this selector (e.g.
 *    selector_bytes!("transfer") when every transfer uses explicit 0xdb20f9f5).
 *  - ARG MISMATCH: a message with this selector exists but its arg count differs
 *    (e.g. calling transfer with (to, amount) when the ABI takes (to, value, data)).
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { blake2AsU8a, cryptoWaitReady } from '@polkadot/util-crypto'
import { u8aToHex } from '@polkadot/util'

const ROOT = join(__dirname, '../..')
const CONTRACTS = join(ROOT, 'Lunex/contracts')
const ARTIFACTS = join(ROOT, 'target/ink')

const sel = (name: string): string =>
  u8aToHex(blake2AsU8a(name, 256).slice(0, 4))

// 1) Union of all ABI messages: selector -> [{contract,label,argCount}]
function loadAbiMessages() {
  const bySelector = new Map<string, Array<{ c: string; label: string; args: number }>>()
  for (const dir of readdirSync(ARTIFACTS)) {
    const p = join(ARTIFACTS, dir, `${dir}.json`)
    let j: any
    try {
      j = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      continue
    }
    for (const m of j?.spec?.messages ?? []) {
      const arr = bySelector.get(m.selector) ?? []
      arr.push({ c: dir, label: m.label, args: m.args.length })
      bySelector.set(m.selector, arr)
    }
  }
  return bySelector
}

// 2) Extract every cross-contract call block from a lib.rs
function extractCalls(src: string, file: string) {
  const calls: Array<{ file: string; name: string; selector: string; pushArgs: number; line: number }> = []
  const parts = src.split('build_call')
  // Each part after the first begins inside a build_call chain.
  let offset = parts[0].length
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i]
    // chain ends at .invoke or .try_invoke
    const endIdx = (() => {
      const a = block.indexOf('.try_invoke')
      const b = block.indexOf('.invoke')
      const idxs = [a, b].filter((x) => x >= 0)
      return idxs.length ? Math.min(...idxs) : block.length
    })()
    const chain = block.slice(0, endIdx)
    const m = chain.match(/selector_bytes!\("([^"]+)"\)/)
    if (m) {
      const pushArgs = (chain.match(/\.push_arg\(/g) || []).length
      const line = src.slice(0, offset).split('\n').length
      calls.push({ file, name: m[1], selector: sel(m[1]), pushArgs, line })
    }
    offset += 'build_call'.length + block.length
  }
  return calls
}

async function main() {
  await cryptoWaitReady()
  const abi = loadAbiMessages()

  const allCalls: ReturnType<typeof extractCalls> = []
  for (const dir of readdirSync(CONTRACTS)) {
    const p = join(CONTRACTS, dir, 'lib.rs')
    let src: string
    try {
      src = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    allCalls.push(...extractCalls(src, `${dir}/lib.rs`))
  }

  console.log(`\nAuditadas ${allCalls.length} cross-calls em ${CONTRACTS}\n`)
  const problems: string[] = []
  for (const call of allCalls) {
    const matches = abi.get(call.selector)
    if (!matches) {
      problems.push(
        `❌ DANGLING  ${call.file}:${call.line}  selector_bytes!("${call.name}") = ${call.selector} → nenhuma ABI tem esse selector`,
      )
      continue
    }
    // does any matched message accept this arg count?
    const argOk = matches.some((mm) => mm.args === call.pushArgs)
    if (!argOk) {
      const exp = [...new Set(matches.map((mm) => mm.args))].join('/')
      problems.push(
        `⚠️  ARGS     ${call.file}:${call.line}  "${call.name}" (${call.selector}) push_arg=${call.pushArgs} mas ABI(${matches.map((mm) => mm.label).join(',')}) espera ${exp}`,
      )
    }
  }

  if (problems.length === 0) {
    console.log('✅ Nenhum problema de selector/args em cross-calls.\n')
  } else {
    console.log(`Encontrados ${problems.length} achados:\n`)
    for (const p of problems) console.log('  ' + p)
    console.log('')
  }
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})

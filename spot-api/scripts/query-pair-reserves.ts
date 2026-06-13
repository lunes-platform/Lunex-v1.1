/**
 * Read-only diagnostic: queries WLUNES/LUSDT pair reserves and token order
 * to validate the UI add-liquidity quote against the real on-chain ratio.
 * Usage: npx tsx scripts/query-pair-reserves.ts
 */
import { ApiPromise, WsProvider } from '@polkadot/api';
import { ContractPromise } from '@polkadot/api-contract';
import * as fs from 'fs';
import * as path from 'path';

const WS = process.env.LUNES_WS_URL || 'ws://localhost:9944';

async function main(): Promise<void> {
  const addrs = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../deployed-addresses.json'), 'utf8'),
  );
  const pairAbi = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../../lunes-dex-main/src/abis/Pair.json'),
      'utf8',
    ),
  );

  const api = await ApiPromise.create({
    provider: new WsProvider(WS),
    noInitWarn: true,
  });
  const pair = new ContractPromise(api, pairAbi, addrs.pairWlunesLusdt);
  const gas = api.registry.createType('WeightV2', {
    refTime: 500_000_000_000n,
    proofSize: 5_000_000n,
  });
  const caller = addrs.router;

  const q = async (msg: string) => {
    const { result, output } = await pair.query[msg](caller, {
      gasLimit: gas as never,
    });
    if (!result.isOk || !output) throw new Error(`${msg} failed`);
    return output.toJSON() as Record<string, unknown>;
  };

  const reserves = (await q('getReserves')) as { ok: [string, string, number] };
  const token0 = (await q('token0')) as { ok: string };
  const token1 = (await q('token1')) as { ok: string };

  const [r0, r1] = reserves.ok;
  const t0 = token0.ok;
  const wlunesIsToken0 = t0 === addrs.wnative;

  const rawWlunes = BigInt(wlunesIsToken0 ? r0 : r1);
  const rawLusdt = BigInt(wlunesIsToken0 ? r1 : r0);
  const humanWlunes = Number(rawWlunes) / 1e8;
  const humanLusdt = Number(rawLusdt) / 1e6;

  console.log('token0:', t0, wlunesIsToken0 ? '(WLUNES)' : '(LUSDT)');
  console.log('token1:', token1.ok);
  console.log('reserva WLUNES (raw):', rawWlunes.toString(), '=', humanWlunes);
  console.log('reserva LUSDT  (raw):', rawLusdt.toString(), '=', humanLusdt);
  console.log('ratio humano LUSDT/WLUNES:', humanLusdt / humanWlunes);
  console.log('ratio raw r_lusdt/r_wlunes:', Number(rawLusdt) / Number(rawWlunes));
  await api.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

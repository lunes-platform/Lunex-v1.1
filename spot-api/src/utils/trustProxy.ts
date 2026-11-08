import net from 'net';

/**
 * Reverse-proxy trust setting shared by Express (`trust proxy`) and the
 * WebSocket server, so both derive the client IP the same way.
 *
 *  - `false`     → never read X-Forwarded-For; client = socket peer.
 *  - `number` N  → trust the N proxy hops closest to the server (nginx = 1,
 *                  Cloudflare → nginx = 2). Client = N-th hop from the right.
 *  - `string[]`  → trust peers inside these CIDRs / IPs / keywords
 *                  (`loopback`, `linklocal`, `uniquelocal`); client = the
 *                  right-most hop that is NOT trusted.
 */
export type TrustProxySetting = false | number | string[];

const KEYWORDS: Record<string, string[]> = {
  loopback: ['127.0.0.1/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

function stripMapped(ip: string): string {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) {
    return ip.slice(7);
  }
  return ip;
}

/** Normalizes an IP (drops IPv4-mapped IPv6 prefix); null when not an IP. */
export function normalizeIp(value: string | undefined | null): string | null {
  if (!value) return null;
  const ip = stripMapped(value.trim());
  return net.isIP(ip) ? ip : null;
}

function isValidTrustEntry(entry: string): boolean {
  if (KEYWORDS[entry.toLowerCase()]) return true;
  const [ip, prefix, extra] = entry.split('/');
  if (extra !== undefined || !net.isIP(stripMapped(ip))) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const max = net.isIPv6(stripMapped(ip)) ? 128 : 32;
  return Number(prefix) <= max;
}

/**
 * Parses TRUST_PROXY. Accepts `false`/empty/`0` (off), a hop count, the
 * legacy `true` (= 1 hop, nginx in front) or a comma-separated CIDR/IP list.
 * Throws on malformed list entries so a typo never silently trusts everyone.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? '').trim();
  const lower = value.toLowerCase();
  if (!value || lower === 'false' || value === '0') return false;
  if (lower === 'true') return 1;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (!isValidTrustEntry(entry)) {
      throw new Error(
        `Invalid TRUST_PROXY entry "${entry}" (expected hop count, IP, CIDR or loopback/linklocal/uniquelocal)`,
      );
    }
  }
  return entries;
}

export function compileTrustList(entries: string[]): (ip: string) => boolean {
  const list = new net.BlockList();
  const expanded = entries.flatMap(
    (entry) => KEYWORDS[entry.toLowerCase()] ?? [entry],
  );
  for (const entry of expanded) {
    const [rawIp, prefix] = entry.split('/');
    const ip = stripMapped(rawIp);
    const type = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
    if (prefix === undefined) list.addAddress(ip, type);
    else list.addSubnet(ip, Number(prefix), type);
  }
  return (candidate: string) => {
    const ip = normalizeIp(candidate);
    if (!ip) return false;
    return list.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
  };
}

/**
 * Client IP using the same semantics as Express `trust proxy`: walk from the
 * socket peer towards the left of X-Forwarded-For while the current hop is
 * trusted. Values a client prepends to XFF are never reached unless every
 * hop to their right is a trusted proxy.
 */
export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  setting: TrustProxySetting,
): string {
  const remote = normalizeIp(remoteAddress) ?? remoteAddress ?? 'unknown';
  if (setting === false) return remote;

  const header = Array.isArray(forwardedFor)
    ? forwardedFor.join(',')
    : (forwardedFor ?? '');
  const hops = header
    .split(',')
    .map((hop) => normalizeIp(hop))
    .filter((hop): hop is string => hop !== null)
    .reverse();
  const chain = [remote, ...hops];

  if (typeof setting === 'number') {
    return chain[Math.min(setting, chain.length - 1)];
  }

  const isTrusted = compileTrustList(setting);
  let index = 0;
  while (index < chain.length - 1 && isTrusted(chain[index])) index++;
  return chain[index];
}

/** Value for `app.set('trust proxy', …)` with identical semantics. */
export function toExpressTrustProxy(
  setting: TrustProxySetting,
): false | number | ((addr: string, index: number) => boolean) {
  if (setting === false || typeof setting === 'number') return setting;
  const isTrusted = compileTrustList(setting);
  return (addr: string) => isTrusted(addr);
}

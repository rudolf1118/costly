import { isIPv4, isIPv6 } from 'node:net';

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * The identity of a client for per-IP rate limits:
 * - an IPv4 address as is (IPv4-mapped IPv6 like ::ffff:1.2.3.4 becomes 1.2.3.4,
 *   so one client never has two budgets);
 * - an IPv6 address as its /64 prefix, because every IPv6 subscriber controls
 *   a whole /64 (2^64 addresses) and could otherwise use a new one per request;
 * - anything else as one shared "invalid" bucket, so garbage values can't each
 *   get a budget of their own.
 */
export function rateLimitSubject(ip: string | undefined): string {
  if (!ip) return 'invalid';
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped?.[1] && isIPv4(mapped[1])) return mapped[1];
  if (isIPv4(ip)) return ip;
  const address = ip.split('%')[0] ?? ''; // drop a zone index such as %eth0
  if (isIPv6(address)) return `${hextets(address).slice(0, 4).join(':')}::/64`;
  return 'invalid';
}

/** The eight 16-bit groups of a valid IPv6 address, without leading zeros. */
function hextets(address: string): string[] {
  let text = address;
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)?.[1];
  if (embedded) {
    const [a = 0, b = 0, c = 0, d = 0] = embedded.split('.').map(Number);
    text = `${text.slice(0, -embedded.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const zeros = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((group) => parseInt(group, 16).toString(16));
}

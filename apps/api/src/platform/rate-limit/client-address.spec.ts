import { describe, expect, it } from 'vitest';
import { rateLimitSubject } from './client-address';

describe('rateLimitSubject', () => {
  it('keeps an IPv4 address', () => {
    expect(rateLimitSubject('198.51.100.7')).toBe('198.51.100.7');
  });

  it('maps an IPv4-mapped IPv6 address to its IPv4 address', () => {
    expect(rateLimitSubject('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(rateLimitSubject('::FFFF:198.51.100.7')).toBe('198.51.100.7');
  });

  it.each([
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:0000:0000:0000:0001', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2::abcd', '2001:db8:1:2::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['64:ff9b::198.51.100.7', '64:ff9b:0:0::/64'],
  ])('reduces the IPv6 address %s to its /64, %s', (ip, subject) => {
    expect(rateLimitSubject(ip)).toBe(subject);
  });

  it('separates different /64 networks', () => {
    expect(rateLimitSubject('2001:db8:1:2::1')).not.toBe(rateLimitSubject('2001:db8:1:3::1'));
  });

  it.each([undefined, '', 'not-an-ip', '999.1.1.1', '1.2.3.4, 5.6.7.8', '::ffff:999.1.1.1'])(
    'puts the invalid value %j in one shared bucket',
    (ip) => {
      expect(rateLimitSubject(ip)).toBe('invalid');
    },
  );
});

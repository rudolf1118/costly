import { describe, expect, it } from 'vitest';
import { bigintAsString, MAX_MINOR_UNITS, minorUnits } from './minor-units';

describe('minorUnits', () => {
  it.each([
    ['0', 0n],
    ['150000', 150_000n],
    ['-150000', -150_000n],
    ['999999999999999', MAX_MINOR_UNITS],
    ['-999999999999999', -MAX_MINOR_UNITS],
  ])('parses %j exactly', (input, expected) => {
    expect(minorUnits.parse(input)).toBe(expected);
  });

  it('keeps the bound below the largest exact JS integer', () => {
    expect(MAX_MINOR_UNITS < BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it.each([
    ['a JSON number', 150000],
    ['an unsafe JSON number', Number.MAX_SAFE_INTEGER + 2],
    ['a decimal', '1500.50'],
    ['an exponent', '1e5'],
    ['a leading zero', '0150000'],
    ['a plus sign', '+150000'],
    ['surrounding whitespace', ' 150000'],
    ['negative zero', '-0'],
    ['16 digits', '1000000000000000'],
    ['a negative 16 digits', '-1000000000000000'],
    ['thousands separators', '150,000'],
    ['an empty string', ''],
    ['null', null],
    ['a trailing newline', '150000\n'],
    ['Arabic-Indic digits', '\u0661\u0665\u0660'],
    ['fullwidth digits', '\uff11\uff15\uff10'],
    ['an array', ['150000']],
    ['an object', { value: '150000' }],
    ['a boolean', true],
    ['a bigint', 150_000n],
    ['a 10,000-digit string', '9'.repeat(10_000)],
  ])('rejects %s', (_case, input) => {
    expect(minorUnits.safeParse(input).success).toBe(false);
  });
});

describe('bigintAsString', () => {
  it('serializes bigints as exact decimal strings, nested anywhere', () => {
    const body = { amount: 2n ** 62n, items: [{ balance: -150_000n }], other: 7 };

    expect(JSON.stringify(body, bigintAsString)).toBe(
      '{"amount":"4611686018427387904","items":[{"balance":"-150000"}],"other":7}',
    );
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatAmd,
  InvalidAmountError,
  MAX_MINOR_UNITS,
  parseAmdInput,
  parseMinorUnits,
  serializeMinorUnits,
} from './money';

const NBSP = ' ';
const MINUS = '−';

/** Every amount the API can send or accept. */
const apiAmount = fc.bigInt({ min: -MAX_MINOR_UNITS, max: MAX_MINOR_UNITS });

describe('parseMinorUnits', () => {
  it.each([
    ['0', 0n],
    ['150000', 150_000n],
    ['-150000', -150_000n],
    ['150050', 150_050n],
    ['999999999999999', MAX_MINOR_UNITS],
    ['-999999999999999', -MAX_MINOR_UNITS],
  ])('parses %j exactly', (input, expected) => {
    expect(parseMinorUnits(input)).toBe(expected);
  });

  it.each([
    ['a JSON number', 150000],
    ['a bigint', 150_000n],
    ['null', null],
    ['undefined', undefined],
    ['a decimal', '1500.50'],
    ['an exponent', '1e5'],
    ['a leading zero', '0150000'],
    ['a plus sign', '+150000'],
    ['surrounding whitespace', ' 150000'],
    ['a trailing newline', '150000\n'],
    ['negative zero', '-0'],
    ['16 digits', '1000000000000000'],
    ['a negative 16 digits', '-1000000000000000'],
    ['thousands separators', '150,000'],
    ['an empty string', ''],
    ['fullwidth digits', '１５０'],
    ['U+2212 as the minus', `${MINUS}150000`],
  ])('rejects %s', (_case, input) => {
    expect(() => parseMinorUnits(input)).toThrow(InvalidAmountError);
  });

  it('never echoes the rejected value in its message', () => {
    expect(() => parseMinorUnits('secret-ish 12345')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('12345') }),
    );
  });

  it('round-trips every amount in the API range', () => {
    fc.assert(
      fc.property(apiAmount, (minor) => {
        expect(parseMinorUnits(serializeMinorUnits(minor))).toBe(minor);
      }),
    );
  });
});

describe('serializeMinorUnits', () => {
  it('writes the exact decimal string', () => {
    expect(serializeMinorUnits(-1_250_000n)).toBe('-1250000');
    expect(serializeMinorUnits(0n)).toBe('0');
  });

  it('refuses amounts the API would reject', () => {
    expect(() => serializeMinorUnits(MAX_MINOR_UNITS + 1n)).toThrow(InvalidAmountError);
    expect(() => serializeMinorUnits(-MAX_MINOR_UNITS - 1n)).toThrow(InvalidAmountError);
  });
});

describe('formatAmd', () => {
  it.each([
    [0n, `0${NBSP}֏`],
    [100n, `1${NBSP}֏`],
    [150_000n, `1,500${NBSP}֏`],
    [367_820_000n, `3,678,200${NBSP}֏`],
    [100_000_000n, `1,000,000${NBSP}֏`],
    [MAX_MINOR_UNITS, `9,999,999,999,999.99${NBSP}֏`],
  ])('formats %s whole dram without decimals', (minor, expected) => {
    expect(formatAmd(minor)).toBe(expected);
  });

  it.each([
    [150_050n, `1,500.50${NBSP}֏`],
    [150_005n, `1,500.05${NBSP}֏`],
    [1n, `0.01${NBSP}֏`],
    [99n, `0.99${NBSP}֏`],
  ])('shows the two decimals of %s instead of rounding them away', (minor, expected) => {
    expect(formatAmd(minor)).toBe(expected);
  });

  it('marks negative amounts with U+2212 by default and nothing on positives', () => {
    expect(formatAmd(-14_230_000n)).toBe(`${MINUS}${NBSP}142,300${NBSP}֏`);
    expect(formatAmd(85_000_000n)).toBe(`850,000${NBSP}֏`);
  });

  it('signs every non-zero amount when asked, but never zero', () => {
    expect(formatAmd(85_000_000n, { sign: 'always' })).toBe(`+${NBSP}850,000${NBSP}֏`);
    expect(formatAmd(-1_840_000n, { sign: 'always' })).toBe(`${MINUS}${NBSP}18,400${NBSP}֏`);
    expect(formatAmd(0n, { sign: 'always' })).toBe(`0${NBSP}֏`);
  });

  it('drops the sign and the symbol on request', () => {
    expect(formatAmd(-1_840_000n, { sign: 'never', symbol: false })).toBe('18,400');
  });

  it('formats sums beyond the per-amount API range exactly', () => {
    expect(formatAmd(2n ** 70n, { symbol: false })).toBe('11,805,916,207,174,113,034.24');
  });

  it('keeps every digit and groups them in threes', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }), (minor) => {
        const text = formatAmd(minor, { sign: 'never', symbol: false });
        const [whole = '', fraction] = text.split('.');
        const groups = whole.split(',');

        expect(groups.slice(1).every((g) => g.length === 3)).toBe(true);
        expect(groups[0]?.length).toBeGreaterThanOrEqual(1);
        expect(groups[0]?.length).toBeLessThanOrEqual(3);

        const magnitude = minor < 0n ? -minor : minor;
        expect(fraction !== undefined).toBe(magnitude % 100n !== 0n);
        expect(BigInt(groups.join('')) * 100n + BigInt(fraction ?? '0')).toBe(magnitude);
      }),
    );
  });
});

describe('parseAmdInput', () => {
  it.each([
    ['0', 0n],
    ['1500', 150_000n],
    ['1,500', 150_000n],
    ['1 500', 150_000n],
    [`1${NBSP}500`, 150_000n],
    ['1,500,000', 150_000_000n],
    ['1500.5', 150_050n],
    ['1500.50', 150_050n],
    ['1,500.05', 150_005n],
    ['0.01', 1n],
    ['  1500  ', 150_000n],
    ['+1500', 150_000n],
    [`1,500${NBSP}֏`, 150_000n],
    ['1500 ֏', 150_000n],
    ['9999999999999.99', MAX_MINOR_UNITS],
  ])('reads %j', (input, expected) => {
    expect(parseAmdInput(input)).toEqual({ ok: true, minor: expected });
  });

  it.each([
    ['-1500', -150_000n],
    [`${MINUS}1,500`, -150_000n],
    [`${MINUS}${NBSP}1,500.50${NBSP}֏`, -150_050n],
  ])('reads negative %j when the field allows it', (input, expected) => {
    expect(parseAmdInput(input, { allowNegative: true })).toEqual({ ok: true, minor: expected });
  });

  it('refuses a negative amount unless the field allows it', () => {
    expect(parseAmdInput('-1500')).toEqual({ ok: false, error: 'negative' });
  });

  it('treats a negative zero as zero', () => {
    expect(parseAmdInput('-0')).toEqual({ ok: true, minor: 0n });
  });

  it.each(['', '   ', NBSP])('reports %j as empty', (input) => {
    expect(parseAmdInput(input)).toEqual({ ok: false, error: 'empty' });
  });

  it.each([
    ['a comma used as the decimal separator', '1,5'],
    ['a misplaced grouping comma', '15,00'],
    ['mixed grouping separators', '1,500 000'],
    ['a grouped number with a leading zero', '0,500'],
    ['a trailing decimal point', '1500.'],
    ['a missing whole part', '.5'],
    ['an exponent', '1e5'],
    ['letters', 'abc'],
    ['two signs', '--1500'],
    ['fullwidth digits', '１５００'],
    ['a symbol before the number', '֏1500'],
    ['two decimal points', '1.500.00'],
  ])('rejects %s', (_case, input) => {
    expect(parseAmdInput(input, { allowNegative: true })).toEqual({ ok: false, error: 'format' });
  });

  it('rejects a third decimal instead of rounding it', () => {
    expect(parseAmdInput('1500.505')).toEqual({ ok: false, error: 'precision' });
  });

  it('rejects amounts beyond the API range', () => {
    expect(parseAmdInput('10000000000000')).toEqual({ ok: false, error: 'range' });
    expect(parseAmdInput('9'.repeat(10_000))).toEqual({ ok: false, error: 'range' });
  });

  it('reads back everything formatAmd displays', () => {
    fc.assert(
      fc.property(apiAmount, fc.boolean(), (minor, symbol) => {
        const shown = formatAmd(minor, { symbol, sign: 'always' });
        expect(parseAmdInput(shown, { allowNegative: true })).toEqual({ ok: true, minor });
      }),
    );
  });
});

/**
 * Money as Costly's clients handle it (ADR-0002, ADR-0010).
 *
 * Amounts are integer minor units held in a `bigint` from the moment they are
 * parsed until they are formatted. Nothing here converts an amount to a
 * `number`, so no amount is ever rounded by floating point.
 */

/** The largest magnitude the API accepts, in minor units (`api-conventions.md`, Money). */
export const MAX_MINOR_UNITS = 999_999_999_999_999n;

/** AMD has an ISO 4217 exponent of 2: 1 dram is 100 luma. */
const AMD_EXPONENT = 2;
const MINOR_PER_MAJOR = 10n ** BigInt(AMD_EXPONENT);

const DRAM_SIGN = '֏';
const MINUS_SIGN = '−';
/** Keeps a sign, its number and the currency symbol on one line. */
const NBSP = ' ';

/** The API's grammar: an optional minus, then 0 or up to 15 digits without a leading zero. */
const MINOR_UNITS = /^-?(?:0|[1-9][0-9]{0,14})$/;

export class InvalidAmountError extends Error {
  override readonly name = 'InvalidAmountError';
}

/**
 * Parses an amount as the API sends it: a decimal string of minor units,
 * such as `"150000"` for 1,500 AMD. Anything the API itself would reject is
 * rejected here too — JSON numbers, decimals, exponents, whitespace, `+`,
 * `-0` and values beyond ±999,999,999,999,999 — instead of being converted.
 * The error message never contains the rejected value.
 */
export function parseMinorUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !MINOR_UNITS.test(value) || value === '-0') {
    throw new InvalidAmountError('Expected a decimal string of minor units, such as "150000".');
  }
  return BigInt(value);
}

/** The exact string an amount travels as in a request body. */
export function serializeMinorUnits(minor: bigint): string {
  if (minor > MAX_MINOR_UNITS || minor < -MAX_MINOR_UNITS) {
    throw new InvalidAmountError('The amount is outside the range the API accepts.');
  }
  return minor.toString();
}

export type SignDisplay =
  /** A minus for negative amounts only. For balances. */
  | 'negative'
  /** A plus or a minus for every non-zero amount. For transactions and changes. */
  | 'always'
  /** No sign at all. For amounts whose direction is shown some other way. */
  | 'never';

export interface FormatAmdOptions {
  sign?: SignDisplay;
  /** Append the dram sign. Default `true`. */
  symbol?: boolean;
}

/**
 * Formats minor units of AMD for display, following the approved design:
 * comma grouping, the dram sign after the number, U+2212 for minus.
 *
 * AMD is normally shown without decimals. An amount that isn't a whole
 * number of dram shows its two decimals instead of being rounded, so the
 * screen never hides money: `150000n` is "1,500 ֏" and `150050n` is
 * "1,500.50 ֏".
 *
 * Any `bigint` is accepted, including sums beyond the API's per-amount range.
 */
export function formatAmd(minor: bigint, options: FormatAmdOptions = {}): string {
  const { sign = 'negative', symbol = true } = options;

  const magnitude = minor < 0n ? -minor : minor;
  const whole = groupThousands((magnitude / MINOR_PER_MAJOR).toString());
  const fraction = magnitude % MINOR_PER_MAJOR;
  const number =
    fraction === 0n ? whole : `${whole}.${fraction.toString().padStart(AMD_EXPONENT, '0')}`;

  let prefix = '';
  if (sign !== 'never') {
    if (minor < 0n) prefix = MINUS_SIGN + NBSP;
    else if (minor > 0n && sign === 'always') prefix = '+' + NBSP;
  }

  return prefix + number + (symbol ? NBSP + DRAM_SIGN : '');
}

function groupThousands(digits: string): string {
  const head = digits.length % 3 || 3;
  let grouped = digits.slice(0, head);
  for (let i = head; i < digits.length; i += 3) {
    grouped += ',' + digits.slice(i, i + 3);
  }
  return grouped;
}

export type AmountInputError =
  /** Nothing was entered. */
  | 'empty'
  /** Not a number in a form Costly reads. */
  | 'format'
  /** More than two decimals. */
  | 'precision'
  /** Negative, where the field doesn't allow it. */
  | 'negative'
  /** Beyond ±9,999,999,999,999.99 AMD. */
  | 'range';

export type AmountInputResult =
  { ok: true; minor: bigint } | { ok: false; error: AmountInputError };

export interface ParseAmdInputOptions {
  /** Accept a leading minus. Default `false`. */
  allowNegative?: boolean;
}

/**
 * Reads an amount a person typed in dram, such as "1500", "1,500",
 * "1 500.5" or "−1,500.50", and returns it in minor units.
 *
 * - The decimal separator is ".". Commas and spaces are grouping only, and
 *   only where a grouping separator belongs, so "1,5" is rejected rather
 *   than silently read as 15 or as 1.5.
 * - At most two decimals; a third is an error, never rounded away.
 * - Only ASCII digits. The dram sign may follow the number.
 * - Accepts everything `formatAmd` produces, so a displayed amount can be
 *   typed back in.
 */
export function parseAmdInput(text: string, options: ParseAmdInputOptions = {}): AmountInputResult {
  let rest = text.replace(/\s+/gu, ' ').trim();
  if (rest === '') return { ok: false, error: 'empty' };

  if (rest.endsWith(DRAM_SIGN)) rest = rest.slice(0, -DRAM_SIGN.length).trimEnd();

  let negative = false;
  if (rest.startsWith('-') || rest.startsWith(MINUS_SIGN)) {
    negative = true;
    rest = rest.slice(1).trimStart();
  } else if (rest.startsWith('+')) {
    rest = rest.slice(1).trimStart();
  }

  const match = /^([0-9]{1,3}(?:([, ])[0-9]{3}(?:\2[0-9]{3})*)?|[0-9]+)(?:\.([0-9]+))?$/.exec(rest);
  if (!match) return { ok: false, error: 'format' };
  // "0,500" is how comma-decimal locales write half a dram; refuse to guess.
  if (match[2] !== undefined && rest.startsWith('0')) return { ok: false, error: 'format' };

  const wholeDigits = (match[1] ?? '').replace(/[, ]/g, '');
  const fractionDigits = match[3] ?? '';
  if (fractionDigits.length > AMD_EXPONENT) return { ok: false, error: 'precision' };

  const magnitude =
    BigInt(wholeDigits) * MINOR_PER_MAJOR + BigInt(fractionDigits.padEnd(AMD_EXPONENT, '0'));
  if (magnitude > MAX_MINOR_UNITS) return { ok: false, error: 'range' };
  if (negative && magnitude !== 0n && !options.allowNegative) {
    return { ok: false, error: 'negative' };
  }

  return { ok: true, minor: negative ? -magnitude : magnitude };
}

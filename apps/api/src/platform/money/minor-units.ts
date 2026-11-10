import { z } from 'zod';

/**
 * The largest magnitude an amount may have, in minor units: about ±10 trillion
 * AMD. Below 2^53, so a client can also hold any single amount exactly in a
 * JS number for display, and far from bigint's limit when amounts are summed.
 */
export const MAX_MINOR_UNITS = 999_999_999_999_999n;

/** An optional minus, then 0 or up to 15 digits without a leading zero. */
const MINOR_UNITS = /^-?(?:0|[1-9][0-9]{0,14})$/;

/**
 * An amount as it crosses the API (ADR-0002): a decimal string of minor units,
 * such as "150000" for 1,500 AMD. JSON numbers, decimals, exponents, spaces,
 * "+" and "-0" are rejected rather than converted, so nothing is ever rounded.
 * The parsed value is a bigint.
 */
export const minorUnits = z
  .string({ error: 'Must be a string of minor units, such as "150000"' })
  .regex(MINOR_UNITS, {
    error: 'Must be a whole number of minor units between -999999999999999 and 999999999999999',
  })
  .refine((value) => value !== '-0', { error: 'Must not be negative zero' })
  .transform((value) => BigInt(value));

/**
 * JSON.stringify throws on bigint. Registered as Express's JSON replacer, this
 * renders every bigint in a response as its decimal string: the one global
 * serializer ADR-0002 asks for, so no endpoint can send money as a number.
 */
export function bigintAsString(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

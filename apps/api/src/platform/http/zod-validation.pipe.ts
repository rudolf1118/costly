import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export interface ValidationIssue {
  /** Dotted path to the field, e.g. "email"; empty for the body as a whole. */
  path: string;
  message: string;
}

/** A rejected request body; ProblemDetailsFilter turns it into a 400 with an errors list. */
export class RequestValidationException extends BadRequestException {
  constructor(readonly errors: ValidationIssue[]) {
    super('The request body is invalid.');
  }
}

/**
 * Parses a request body with a zod schema and hands the parsed value (with
 * its transforms applied) to the handler. Issue messages never contain the
 * submitted values, so a rejected password is not echoed back.
 */
export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new RequestValidationException(
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RequestValidationException, ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({
  name: z.string().trim().min(1),
  nested: z.object({ count: z.number().int() }),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value with transforms applied', () => {
    expect(pipe.transform({ name: '  Anna  ', nested: { count: 2 } })).toEqual({
      name: 'Anna',
      nested: { count: 2 },
    });
  });

  it('reports every invalid field with its dotted path', () => {
    const error = catchError(() => pipe.transform({ name: '', nested: { count: 1.5 } }));

    expect(error).toBeInstanceOf(RequestValidationException);
    expect(error.getStatus()).toBe(400);
    expect(error.errors.map((issue) => issue.path)).toEqual(['name', 'nested.count']);
  });

  it('reports a body that is not an object at the root path', () => {
    const error = catchError(() => pipe.transform('not json'));

    expect(error.errors).toEqual([{ path: '', message: expect.any(String) }]);
  });

  it('does not echo submitted values in its messages', () => {
    const secret = 'correct horse battery staple';
    const strict = new ZodValidationPipe(z.object({ password: z.string().max(5) }));

    const error = catchError(() => strict.transform({ password: secret }));

    expect(JSON.stringify(error.errors)).not.toContain(secret);
  });
});

function catchError(action: () => unknown): RequestValidationException {
  try {
    action();
  } catch (error) {
    return error as RequestValidationException;
  }
  throw new Error('expected the pipe to reject the value');
}

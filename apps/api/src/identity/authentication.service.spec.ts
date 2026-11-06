import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationService } from './authentication.service';
import type * as password from './password';
import { hashPassword, verifyPassword } from './password';

// Spy on verifyPassword while keeping its real behaviour.
vi.mock('./password', async (importOriginal) => {
  const actual = await importOriginal<typeof password>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const ARGON2ID_HASH = /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/;

describe('AuthenticationService.login', () => {
  afterEach(() => {
    vi.mocked(verifyPassword).mockClear();
  });

  async function serviceFinding(user: { id: string; passwordHash: string } | null) {
    const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
    const limiter = { ensureBelow: vi.fn(), hit: vi.fn() };
    const service = new AuthenticationService(
      prisma as never,
      {} as never,
      {} as never,
      limiter as never,
    );
    await service.onModuleInit();
    return service;
  }

  // The timing defence: an unknown email costs the same Argon2id verification
  // as a wrong password, so response time doesn't reveal which it was.
  it('verifies against a dummy hash with the real parameters when the email is unknown', async () => {
    const service = await serviceFinding(null);

    await expect(service.login('nobody@costly.test', 'any password')).rejects.toThrow(
      'Invalid email or password.',
    );

    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(vi.mocked(verifyPassword).mock.calls[0]?.[0]).toMatch(ARGON2ID_HASH);
  });

  it("verifies against the user's own hash when the email exists", async () => {
    const passwordHash = await hashPassword('the real password');
    const service = await serviceFinding({ id: 'user-id', passwordHash });

    await expect(service.login('anna@costly.test', 'a wrong password')).rejects.toThrow(
      'Invalid email or password.',
    );

    expect(vi.mocked(verifyPassword).mock.calls[0]?.[0]).toBe(passwordHash);
  });
});

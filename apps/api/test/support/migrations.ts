import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Brings a throwaway database up to the committed schema. Tests must never
 * call `migrate dev`, which is interactive and writes new migration files.
 */
export async function applyMigrations(databaseUrl: string): Promise<void> {
  await run('prisma', ['migrate', 'deploy'], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

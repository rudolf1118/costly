import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { configureHttp } from '../../src/platform/http/configure-http';

/**
 * Starts the application under test with the production HTTP configuration
 * (cookies, CORS) on 127.0.0.1 with a free port, once.
 *
 * Supertest connects to 127.0.0.1. Given a server that is not listening, it
 * binds one itself on [::]:0 for every request and closes it afterwards. On
 * macOS that wildcard bind succeeds even when another process already holds
 * 127.0.0.1 on the same port (Docker port forwards, editor helpers), and the
 * request is then answered by that process: "socket hang up" or a stray 401.
 * Binding to 127.0.0.1 explicitly, once, rules this out.
 */
export async function startHttpServer(app: INestApplication): Promise<void> {
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo | null;
  if (address?.address !== '127.0.0.1') {
    throw new Error(`expected the test server on 127.0.0.1, got ${JSON.stringify(address)}`);
  }
}

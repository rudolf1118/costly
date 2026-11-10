import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHttpServer } from './http';

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { from: 'app under test' };
  }

  @Get('money')
  money() {
    return { amount: 2n ** 62n, nested: [{ balance: -150_000n }] };
  }
}

// ConfigModule because startHttpServer reads the CORS origin from configuration.
@Module({ imports: [ConfigModule.forRoot({ ignoreEnvFile: true })], controllers: [PingController] })
class PingModule {}

/** Regression cover for the intermittent e2e failures of task 3 (see startHttpServer). */
describe('startHttpServer', () => {
  let app: INestApplication;
  let decoy: Server;

  beforeAll(async () => {
    // Another local service holding a loopback port, like a Docker port forward.
    decoy = createServer((_req, res) => {
      res.statusCode = 401;
      res.end();
    });
    await new Promise<void>((resolve) => decoy.listen(0, '127.0.0.1', resolve));

    const moduleRef = await Test.createTestingModule({ imports: [PingModule] }).compile();
    app = moduleRef.createNestApplication();
    await startHttpServer(app);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => decoy?.close(resolve));
  });

  it('binds the port supertest connects to, so no other process can answer', () => {
    const ours = app.getHttpServer().address() as AddressInfo;
    const theirs = decoy.address() as AddressInfo;

    expect(ours.address).toBe('127.0.0.1');
    expect(ours.port).not.toBe(theirs.port);
  });

  it('keeps one server for the whole suite instead of rebinding per request', async () => {
    const before = (app.getHttpServer().address() as AddressInfo).port;

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/ping').expect(200, { from: 'app under test' });
    }

    expect(app.getHttpServer().listening).toBe(true);
    expect((app.getHttpServer().address() as AddressInfo).port).toBe(before);
  });

  it('serializes bigint money in any response as exact decimal strings', async () => {
    const res = await request(app.getHttpServer()).get('/ping/money').expect(200);

    expect(res.text).toBe('{"amount":"4611686018427387904","nested":[{"balance":"-150000"}]}');
  });
});

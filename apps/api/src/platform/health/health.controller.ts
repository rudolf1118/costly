import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }
}

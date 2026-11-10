import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimiter } from './rate-limiter.service';

@Module({
  imports: [RedisModule],
  providers: [RateLimiter, RateLimitGuard],
  exports: [RateLimiter, RateLimitGuard],
})
export class RateLimitModule {}

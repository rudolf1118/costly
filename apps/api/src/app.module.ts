import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [PlatformModule],
})
export class AppModule {}

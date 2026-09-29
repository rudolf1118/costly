import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Database access for the whole application. PrismaService handles its own
 * connection lifecycle, so the module only has to publish it.
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}

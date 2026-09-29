// Prisma 7 no longer reads the connection URL from the schema or loads .env on
// its own, so the CLI gets both from here. The running application does not use
// this file; it reads DATABASE_URL through the validated ConfigService.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
});

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';
export * from './video-status';
export * from './node-execution';
export * from './activity';
export * from './notification';
export * from './alert-engine';
export { PrismaPg };

export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

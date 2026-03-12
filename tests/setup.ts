import { execSync } from 'child_process';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'file:./test.db';

const prismaDir = path.resolve(__dirname, '..', 'prisma');
execSync('npx prisma migrate deploy', {
  env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  cwd: prismaDir.replace('/prisma', ''),
  stdio: 'pipe',
});

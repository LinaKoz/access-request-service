import crypto from 'crypto';
import { PrismaClient, RequestStatus } from '@prisma/client';

const prisma = new PrismaClient();

function payloadFP(application: string, reason: string): string {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ application, reason }))
    .digest('hex');
}

const SEED_REQUESTS = [
  {
    id: 'seed-req-1',
    employeeId: 'employee-1',
    employeeName: 'Alice',
    application: 'Jira',
    reason: 'Need access to project tracking for onboarding',
    status: RequestStatus.PENDING,
    createdBy: 'employee-1',
    idempotencyKey: 'seed-key-1',
    payloadFingerprint: payloadFP('Jira', 'Need access to project tracking for onboarding'),
  },
  {
    id: 'seed-req-2',
    employeeId: 'employee-2',
    employeeName: 'Bob',
    application: 'GitHub',
    reason: 'Need repository access for code contributions',
    status: RequestStatus.APPROVED,
    createdBy: 'employee-2',
    decisionBy: 'approver-1',
    decisionAt: new Date(),
    decisionNote: 'Approved for engineering team',
    idempotencyKey: 'seed-key-2',
    payloadFingerprint: payloadFP('GitHub', 'Need repository access for code contributions'),
  },
  {
    id: 'seed-req-3',
    employeeId: 'employee-1',
    employeeName: 'Alice',
    application: 'Slack',
    reason: 'Need access to internal communication channels',
    status: RequestStatus.DENIED,
    createdBy: 'employee-1',
    decisionBy: 'approver-2',
    decisionAt: new Date(),
    decisionNote: 'Already has access via SSO',
    idempotencyKey: 'seed-key-3',
    payloadFingerprint: payloadFP('Slack', 'Need access to internal communication channels'),
  },
];

async function main() {
  console.log('Seeding database...');

  for (const req of SEED_REQUESTS) {
    await prisma.accessRequest.upsert({
      where: { id: req.id },
      update: {},
      create: req,
    });
  }

  console.log(`Seeded ${SEED_REQUESTS.length} access requests`);
  console.log('\nAvailable mock users (use POST /api/auth/token):');
  console.log('  employee-1 / Alice   / REQUESTER');
  console.log('  employee-2 / Bob     / REQUESTER');
  console.log('  approver-1 / Carol   / APPROVER');
  console.log('  approver-2 / Dave    / APPROVER');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import 'dotenv/config';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const redis = new Redis(process.env.REDIS_URL!);
const prisma = new PrismaClient();

async function run() {
  let lastId = '0-0';
  console.log('Receipts worker started.');
  while (true) {
    const res:any = await redis.xread('BLOCK', 2000, 'COUNT', 200, 'STREAMS', 'delivery:receipts', lastId);
    if (!res) continue;
    const items:any[] = [];
    for (const [, entries] of res) {
      for (const [id, fields] of entries) {
        items.push({ id, ...JSON.parse(fields[1]) });
        lastId = id;
      }
    }
    if (items.length) {
      await prisma.$transaction(items.map(ev =>
        prisma.communicationLog.updateMany({
          where: { campaignId: ev.campaignId, customerId: ev.customerId, status: 'PENDING' },
          data: { status: ev.status, error: ev.error ?? null, vendorMsgId: ev.vendorMsgId }
        })
      ));
    }
  }
}
run();

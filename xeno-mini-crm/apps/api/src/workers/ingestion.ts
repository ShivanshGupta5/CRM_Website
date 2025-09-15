import 'dotenv/config';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const redis = new Redis(process.env.REDIS_URL!);
const prisma = new PrismaClient();

async function run() {
  let lastIdCust = '0-0';
  let lastIdOrder = '0-0';
  console.log('Ingestion worker started.');
  while (true) {
    const res:any = await redis.xread('BLOCK', 5000, 'STREAMS', 'ingest:customers', 'ingest:orders', lastIdCust, lastIdOrder);
    if (!res) continue;
    for (const [stream, entries] of res) {
      for (const [id, fields] of entries) {
        const payload = JSON.parse(fields[1]);
        if (stream === 'ingest:customers') {
          await prisma.customer.create({ data: {
            name: payload.name,
            email: payload.email ?? null,
            phone: payload.phone ?? null,
            totalSpend: payload.totalSpend ?? 0,
            visits: payload.visits ?? 0,
            lastActiveAt: payload.lastActiveAt ? new Date(payload.lastActiveAt) : new Date(),
          }});
          lastIdCust = id;
        } else {
          await prisma.order.create({ data: {
            customerId: payload.customerId,
            amount: payload.amount,
            createdAt: payload.createdAt ? new Date(payload.createdAt) : new Date(),
          }});
          await prisma.customer.update({ where: { id: payload.customerId }, data: {
            totalSpend: { increment: payload.amount }, visits: { increment: 1 }, lastActiveAt: new Date()
          }});
          lastIdOrder = id;
        }
      }
    }
  }
}
run();

import 'dotenv/config';
import Redis from 'ioredis';
import fetch from 'node-fetch';
import { PrismaClient } from '@prisma/client';

const redis = new Redis(process.env.REDIS_URL!);
const prisma = new PrismaClient();

async function run() {
  let lastId = '0-0';
  console.log('Sender worker started.');
  while (true) {
    const res:any = await redis.xread('BLOCK', 5000, 'STREAMS', 'delivery:send', lastId);
    if (!res) continue;
    for (const [, entries] of res) {
      for (const [id, fields] of entries) {
        const { campaignId, customerId, messageTemplate } = JSON.parse(fields[1]);
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        const message = `Hi ${customer?.name ?? 'there'}, ${messageTemplate}`;
        await fetch(process.env.VENDOR_URL ?? 'http://localhost:8080/vendor/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId, customerId, message })
        });
        lastId = id;
      }
    }
  }
}
run();

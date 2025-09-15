import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import fetch from 'node-fetch';
import swaggerUi from 'swagger-ui-express';
import admin from 'firebase-admin';

const app = express();
app.use(cors());
app.use(express.json());

// Minimal OpenAPI JSON (inline) for quick docs
const openapi:any = {
  openapi: '3.0.0', info: { title: 'Xeno Mini-CRM API', version: '1.0.0' },
  servers: [{ url: 'http://localhost:8080' }],
  paths: {
    '/auth/google': { post: { summary: 'Google ID token -> JWT' } },
    '/auth/firebase': { post: { summary: 'Firebase ID token -> JWT' } },
    '/auth/demo': { post: { summary: 'Demo login -> JWT' } },
    '/api/stats': { get: { summary: 'Dashboard KPIs (auth)' } },
    '/api/stats/series': { get: { summary: 'Dashboard time series (auth)' } },
    '/api/stats/stream': { get: { summary: 'Server-Sent Events: live stats (auth)' } },
    '/api/customers': { get: { summary: 'List customers (auth, q, limit)' } },
    '/api/ingest/customers': { post: { summary: 'Ingest customer (auth)' } },
    '/api/ingest/orders': { post: { summary: 'Ingest order (auth)' } },
    '/api/segments/preview': { post: { summary: 'Preview audience size (auth)' } },
    '/api/segments': { post: { summary: 'Create segment + campaign (auth)' } },
    '/api/campaigns': { get: { summary: 'List campaigns with stats (auth)' } },
    '/api/ai/nl-to-rules': { post: { summary: 'NL prompt -> rules (auth)' } },
    '/api/ai/suggest-messages': { post: { summary: 'Suggest message variants (auth)' } },
    '/api/dev/seed': { post: { summary: 'Seed demo data (x-seed-key)' } }
  }
};
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

const prisma = new PrismaClient();
const useRedis = !!process.env.REDIS_URL && !process.env.NO_REDIS;
const redis = useRedis ? new Redis(process.env.REDIS_URL!) : (null as unknown as Redis);
const jwtSecret = process.env.JWT_SECRET || 'dev_secret';
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const oauthClient = new OAuth2Client(googleClientId);
const devSeedKey = process.env.DEV_SEED_KEY || '';
const vendorSuccessPct = Number(process.env.VENDOR_SUCCESS_PCT || '0.9');

// ---- In-memory stats cache (reduces DB load for real-time stream) ----
let cachedKpis: any = null;
let cachedSeries: any = null;
let lastStatsAt = 0;
async function computeKpis() {
  const [customers, orders, campaigns, logs] = await Promise.all([
    prisma.customer.count(),
    prisma.order.count(),
    prisma.campaign.count(),
    prisma.communicationLog.findMany({ select: { status: true } })
  ]);
  const sent = logs.filter(l => l.status === 'SENT').length;
  const failed = logs.filter(l => l.status === 'FAILED').length;
  cachedKpis = { customers, orders, campaigns, sent, failed };
}
async function computeSeries() {
  const since = new Date(Date.now() - 30 * 864e5);
  const orders = await prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, amount: true } });
  const logs = await prisma.communicationLog.findMany({ where: { updatedAt: { gte: since } }, select: { updatedAt: true, status: true } });
  const byDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);
  const revenueMap = new Map<string, number>();
  const sentMap = new Map<string, number>();
  const failedMap = new Map<string, number>();
  for (const o of orders) { const k = byDay(o.createdAt); revenueMap.set(k, (revenueMap.get(k) || 0) + o.amount); }
  for (const l of logs) { const k = byDay(l.updatedAt); if (l.status === 'SENT') sentMap.set(k, (sentMap.get(k) || 0) + 1); if (l.status === 'FAILED') failedMap.set(k, (failedMap.get(k) || 0) + 1); }
  const days: string[] = []; for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); days.push(d.toISOString().slice(0,10)); }
  // Quarter & extra breakdowns (same as SSE previously)
  const now = new Date();
  const months: string[] = []; for (let i = 2; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth()-i, 1); months.push(d.toLocaleString('en', { month: 'short' })); }
  const revenueQuarter = months.map((m, idx) => { const targetMonth = new Date(now.getFullYear(), now.getMonth()- (2-idx), 1).getMonth(); return orders.filter(o => o.createdAt.getMonth() === targetMonth).reduce((a,b)=>a+b.amount,0); });
  const funnel = [ { stage: 'Queued', value: logs.length }, { stage: 'Sent', value: logs.filter(l=>l.status==='SENT').length }, { stage: 'Failed', value: logs.filter(l=>l.status==='FAILED').length } ];
  const segments:any[] = await prisma.customer.groupBy({ by: ['visits'], _count: { _all: true } }).catch(()=>[]);
  const milestone = [
    { label: 'New (0 visits)', value: segments.find(s=>s.visits===0)?._count?._all || 0 },
    { label: '1-2 visits', value: segments.filter(s=>s.visits>=1 && s.visits<=2).reduce((a,b)=>a+(b._count?._all||0),0) },
    { label: '3-5 visits', value: segments.filter(s=>s.visits>=3 && s.visits<=5).reduce((a,b)=>a+(b._count?._all||0),0) },
    { label: '6+ visits', value: segments.filter(s=>s.visits>=6).reduce((a,b)=>a+(b._count?._all||0),0) },
  ];
  cachedSeries = { days, revenue: days.map(d => revenueMap.get(d) || 0), sent: days.map(d => sentMap.get(d) || 0), failed: days.map(d => failedMap.get(d) || 0), funnel, milestone, revenueQuarter, months, taskReport: [{avatar:'A',done:10,pending:2},{avatar:'B',done:7,pending:3},{avatar:'C',done:5,pending:1},{avatar:'D',done:4,pending:2}] };
}
async function refreshStatsIfStale() {
  const now = Date.now();
  if (now - lastStatsAt < 4000 && cachedKpis && cachedSeries) return;
  try {
    await Promise.all([computeKpis(), computeSeries()]);
    lastStatsAt = now;
  } catch (e) {
    console.warn('stats refresh failed', (e as any)?.message || e);
  }
}

// ---- Firebase Admin Init (optional) ----
const firebaseProjectId = process.env.FB_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
const firebaseClientEmail = process.env.FB_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
const firebasePrivateKey = (process.env.FB_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
if (firebaseProjectId && firebaseClientEmail && firebasePrivateKey) {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: firebaseProjectId,
          clientEmail: firebaseClientEmail,
          privateKey: firebasePrivateKey,
        } as admin.ServiceAccount),
      });
      console.log('Firebase Admin initialized');
    }
  } catch (e) {
    console.warn('Firebase Admin init failed; continuing without Firebase.', e);
  }
}

async function enqueue(stream: string, payload: any) {
  if (useRedis) {
    await redis.xadd(stream, '*', 'payload', JSON.stringify(payload));
  }
}

// ---- Auth Middleware ----
function authRequired(req: any, res: any, next: any) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, jwtSecret) as any;
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// ---- Validation Schemas ----
const CustomerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  totalSpend: z.number().int().nonnegative().optional(),
  visits: z.number().int().nonnegative().optional(),
  lastActiveAt: z.string().datetime().optional(),
});

const OrderSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().int().positive(),
  createdAt: z.string().datetime().optional(),
});

type Rule = { field: 'totalSpend' | 'visits' | 'inactiveDays'; cmp: '>' | '<' | '>=' | '<=' | '=='; value: number };
type RulesNode = { op: 'AND' | 'OR'; rules: (Rule | RulesNode)[] };

type CustomerWhere = any;
function toMongoFilter(node: RulesNode): CustomerWhere {
  const parts = node.rules.map((r:any) => {
    if (r && r.op) return toMongoFilter(r as RulesNode);
    const rr = r as Rule;
    if (rr.field === 'inactiveDays') {
      const since = new Date(Date.now() - rr.value * 24 * 60 * 60 * 1000);
      const cmp = rr.cmp;
      if (cmp === '>' || cmp === '>=') return { lastActiveAt: { lt: since } };
      if (cmp === '<' || cmp === '<=') return { lastActiveAt: { gt: since } };
      if (cmp === '==') return { lastActiveAt: since };
      return {};
    } else {
      const field = rr.field as 'totalSpend'|'visits';
      const map: any = { '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte', '==': 'equals' };
      const op = map[rr.cmp];
      return { [field]: { [op]: rr.value } };
    }
  });
  const key = node.op === 'AND' ? 'AND' : 'OR';
  return { [key]: parts };
}

// ---- Routes ----

// Health
app.get('/health', (_req, res) => res.json({ ok: true, useRedis }));

// Dev seed (guarded)
app.post('/api/dev/seed', async (req, res) => {
  if (!devSeedKey || req.headers['x-seed-key'] !== devSeedKey) return res.status(401).json({ error: 'Unauthorized' });
  const customers = [
    { name: 'Aisha', email: 'aisha@example.com', totalSpend: 12000, visits: 2, lastActiveAt: new Date(Date.now() - 200*864e5) },
    { name: 'Rahul', email: 'rahul@example.com', totalSpend: 3500, visits: 5, lastActiveAt: new Date(Date.now() - 20*864e5) },
    { name: 'Meera', email: 'meera@example.com', totalSpend: 25000, visits: 1, lastActiveAt: new Date(Date.now() - 380*864e5) },
  ];
  await prisma.$transaction(async tx => {
    const created = [] as any[];
    for (const c of customers) created.push(await tx.customer.create({ data: c as any }));
    for (const c of created) {
      await tx.order.create({ data: { customerId: c.id, amount: 1500 } });
      await tx.order.create({ data: { customerId: c.id, amount: 2500 } });
    }
  });
  res.json({ ok: true });
});

// Auth: exchange Google ID token -> JWT
app.post('/auth/google', async (req, res) => {
  try {
    const { idToken } = req.body as { idToken: string };
    if (!idToken) return res.status(400).json({ error: 'idToken required' });
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) return res.status(401).json({ error: 'Invalid token' });
    const email = payload.email;
    const name = payload.name || '';
    const googleId = payload.sub;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { email, name, googleId } });
    } else if (!user.googleId) {
      await prisma.user.update({ where: { id: user.id }, data: { googleId } });
    }
    const token = jwt.sign({ sub: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    res.status(401).json({ error: 'Auth failed' });
  }
});

// Auth: exchange Firebase ID token -> JWT
app.post('/auth/firebase', async (req, res) => {
  try {
    const { idToken } = req.body as { idToken: string };
    if (!idToken) return res.status(400).json({ error: 'idToken required' });
    if (!admin.apps.length) return res.status(500).json({ error: 'Firebase not configured (missing FB_* env vars)' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const email = decoded.email;
    const name = decoded.name || '';
    const firebaseUid = decoded.uid;
    if (!email) return res.status(401).json({ error: 'No email on token' });
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { email, name } });
    }
    const token = jwt.sign({ sub: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name }, firebaseUid });
  } catch (e) {
    console.error('Firebase auth verification failed:', e);
    const msg = (e as any)?.message || 'Auth failed';
    res.status(401).json({ error: msg });
  }
});

// Auth: demo login (for local dev)
app.post('/auth/demo', async (_req, res) => {
  const email = 'demo@local.test';
  const name = 'Demo User';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) user = await prisma.user.create({ data: { email, name } });
  const token = jwt.sign({ sub: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// Ingest: customers
app.post('/api/ingest/customers', authRequired, async (req, res) => {
  const parsed = CustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  if (useRedis) {
    await enqueue('ingest:customers', parsed.data);
  } else {
    await prisma.customer.create({ data: {
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      totalSpend: parsed.data.totalSpend ?? 0,
      visits: parsed.data.visits ?? 0,
      lastActiveAt: parsed.data.lastActiveAt ? new Date(parsed.data.lastActiveAt) : new Date(),
    }});
  }
  res.json({ enqueued: useRedis, persistedDirectly: !useRedis });
});

// Ingest: orders
app.post('/api/ingest/orders', authRequired, async (req, res) => {
  const parsed = OrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  if (useRedis) {
    await enqueue('ingest:orders', parsed.data);
  } else {
    await prisma.order.create({ data: {
      customerId: parsed.data.customerId,
      amount: parsed.data.amount,
      createdAt: parsed.data.createdAt ? new Date(parsed.data.createdAt) : new Date(),
    }});
    await prisma.customer.update({ where: { id: parsed.data.customerId }, data: {
      totalSpend: { increment: parsed.data.amount }, visits: { increment: 1 }, lastActiveAt: new Date()
    }});
  }
  res.json({ enqueued: useRedis, persistedDirectly: !useRedis });
});

// Segment preview (Mongo filter)
app.post('/api/segments/preview', authRequired, async (req: any, res) => {
  const { rules } = req.body as { rules: RulesNode };
  const where = toMongoFilter(rules);
  const audienceSize = await prisma.customer.count({ where });
  res.json({ audienceSize });
});

// Create segment + campaign + logs + enqueue/send
app.post('/api/segments', authRequired, async (req: any, res) => {
  const { name, rules, messageTemplate } = req.body as any;
  const createdById = req.user.id;
  const segment = await prisma.segment.create({ data: { name, rulesJson: rules, createdById } });
  const where = toMongoFilter(rules);
  const customers = await prisma.customer.findMany({ where, select: { id: true, name: true } });
  const campaign = await prisma.campaign.create({
    data: { name: `${name} - ${new Date().toISOString()}`, segmentId: segment.id, messageTemplate, createdById }
  });

  // Create logs
  await prisma.$transaction(async tx => {
    await Promise.all(customers.map(c => tx.communicationLog.create({
      data: { campaignId: campaign.id, customerId: c.id, status: 'PENDING', message: messageTemplate }
    })));
  });

  // Delivery either enqueued (Redis) or inline
  let enqueued = 0;
  for (const c of customers) {
    if (useRedis) {
      await enqueue('delivery:send', { campaignId: campaign.id, customerId: c.id, messageTemplate });
      enqueued++;
    } else {
      const message = `Hi ${c.name ?? 'there'}, ${messageTemplate}`;
      const resp = await fetch(process.env.VENDOR_URL ?? 'http://localhost:8080/vendor/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: campaign.id, customerId: c.id, message })
      });
      const out:any = await resp.json();
      await prisma.communicationLog.updateMany({
        where: { campaignId: campaign.id, customerId: c.id, status: 'PENDING' },
        data: { status: out.status, error: out.status === 'FAILED' ? 'Simulated failure' : null, vendorMsgId: out.vendorMsgId }
      });
    }
  }

  res.json({ segmentId: segment.id, campaignId: campaign.id, enqueued });
});

// Vendor simulation
app.post('/vendor/send', async (req, res) => {
  const { campaignId, customerId, message } = req.body as any;
  const vendorMsgId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sent = Math.random() < vendorSuccessPct;
  if (useRedis) {
    await enqueue('delivery:receipts', { vendorMsgId, campaignId, customerId, status: sent ? 'SENT' : 'FAILED', error: sent ? null : 'Simulated failure', message });
  }
  res.json({ vendorMsgId, status: sent ? 'SENT' : 'FAILED' });
});

// Delivery receipt (if vendor were external)
app.post('/api/delivery/receipt', async (req, res) => {
  if (useRedis) await enqueue('delivery:receipts', req.body);
  res.json({ ok: true });
});

// Campaign history (Mongo aggregation)
app.get('/api/campaigns', authRequired, async (_req, res) => {
  const items = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
  const logs = await prisma.communicationLog.findMany({ select: { campaignId: true, status: true } });
  const map = new Map<string, { total: number; sent: number; failed: number }>();
  for (const l of logs) {
    const e = map.get(l.campaignId) ?? { total: 0, sent: 0, failed: 0 };
    e.total += 1;
    if (l.status === 'SENT') e.sent += 1;
    if (l.status === 'FAILED') e.failed += 1;
    map.set(l.campaignId, e);
  }
  res.json(items.map(i => ({
    id: i.id, name: i.name, createdAt: i.createdAt,
    audienceSize: map.get(i.id)?.total ?? 0,
    sent: map.get(i.id)?.sent ?? 0,
    failed: map.get(i.id)?.failed ?? 0,
  })));
});

// ---- Stats (basic KPIs for dashboard) ----
app.get('/api/stats', authRequired, async (_req, res) => {
  const [customers, orders, campaigns, logs] = await Promise.all([
    prisma.customer.count(),
    prisma.order.count(),
    prisma.campaign.count(),
    prisma.communicationLog.findMany({ select: { status: true } })
  ]);
  const sent = logs.filter(l => l.status === 'SENT').length;
  const failed = logs.filter(l => l.status === 'FAILED').length;
  res.json({ customers, orders, campaigns, sent, failed });
});

// ---- Stats time series: last 30 days revenue and delivery status counts ----
app.get('/api/stats/series', authRequired, async (_req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 864e5);
    const orders = await prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, amount: true } });
    const logs = await prisma.communicationLog.findMany({ where: { updatedAt: { gte: since } }, select: { updatedAt: true, status: true } });
    const byDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);
    const revenueMap = new Map<string, number>();
    const sentMap = new Map<string, number>();
    const failedMap = new Map<string, number>();
    for (const o of orders) {
      const k = byDay(o.createdAt);
      revenueMap.set(k, (revenueMap.get(k) || 0) + o.amount);
    }
    for (const l of logs) {
      const k = byDay(l.updatedAt);
      if (l.status === 'SENT') sentMap.set(k, (sentMap.get(k) || 0) + 1);
      if (l.status === 'FAILED') failedMap.set(k, (failedMap.get(k) || 0) + 1);
    }
    // Build last 30 days arrays
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      days.push(d.toISOString().slice(0,10));
    }
    res.json({
      days,
      revenue: days.map(d => revenueMap.get(d) || 0),
      sent: days.map(d => sentMap.get(d) || 0),
      failed: days.map(d => failedMap.get(d) || 0),
    });
  } catch (e:any) {
    console.error('stats/series failed:', e?.message || e);
    res.status(500).json({ error: 'stats_series_failed' });
  }
});

// ---- Live stats via Server-Sent Events (poll DB periodically) ----
app.get('/api/stats/stream', async (req: any, res) => {
  // Manual JWT auth via query param so EventSource can connect without headers
  try {
    const token = String(req.query.token || '');
    if (!token) return res.status(401).end();
    const payload = jwt.verify(token, jwtSecret) as any;
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
  } catch {
    return res.status(401).end();
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();

  let cancelled = false;
  req.on('close', () => { cancelled = true; });

  async function tick() {
    if (cancelled) return;
    try {
      const [kpisRes, seriesRes] = await Promise.all([
        (async () => {
          const [customers, orders, campaigns, logs] = await Promise.all([
            prisma.customer.count(), prisma.order.count(), prisma.campaign.count(), prisma.communicationLog.findMany({ select: { status: true } })
          ]);
          const sent = logs.filter(l => l.status === 'SENT').length;
          const failed = logs.filter(l => l.status === 'FAILED').length;
          return { customers, orders, campaigns, sent, failed };
        })(),
        (async () => {
          const since = new Date(Date.now() - 30 * 864e5);
          const orders = await prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, amount: true } });
          const logs = await prisma.communicationLog.findMany({ where: { updatedAt: { gte: since } }, select: { updatedAt: true, status: true } });
          const stages = await prisma.communicationLog.findMany({ select: { status: true } });
          const byDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0,10);
          const revenueMap = new Map<string, number>();
          const sentMap = new Map<string, number>();
          const failedMap = new Map<string, number>();
          for (const o of orders) { const k = byDay(o.createdAt); revenueMap.set(k, (revenueMap.get(k) || 0) + o.amount); }
          for (const l of logs) { const k = byDay(l.updatedAt); if (l.status === 'SENT') sentMap.set(k, (sentMap.get(k) || 0) + 1); if (l.status === 'FAILED') failedMap.set(k, (failedMap.get(k) || 0) + 1); }
          const days: string[] = []; for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); days.push(d.toISOString().slice(0,10)); }
          // crude funnel from communication status counts
          const funnel = [
            { stage: 'Queued', value: logs.length },
            { stage: 'Sent', value: logs.filter(l=>l.status==='SENT').length },
            { stage: 'Failed', value: logs.filter(l=>l.status==='FAILED').length },
          ];
          // milestone breakdown based on visits bucket from customers
          const segments = await prisma.customer.groupBy({ by: ['visits'], _count: { _all: true } }).catch(()=>[] as any);
          const milestone = [
            { label: 'New (0 visits)', value: (segments as any[]).find(s=>s.visits===0)?._count?._all || 0 },
            { label: '1-2 visits', value: (segments as any[]).filter(s=>s.visits>=1 && s.visits<=2).reduce((a,b)=>a+(b._count?._all||0),0) },
            { label: '3-5 visits', value: (segments as any[]).filter(s=>s.visits>=3 && s.visits<=5).reduce((a,b)=>a+(b._count?._all||0),0) },
            { label: '6+ visits', value: (segments as any[]).filter(s=>s.visits>=6).reduce((a,b)=>a+(b._count?._all||0),0) },
          ];
          // Quarter revenue (aggregate by month name for last 3 months)
          const now = new Date();
          const months: string[] = [];
          for (let i = 2; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
            months.push(d.toLocaleString('en', { month: 'short' }));
          }
          const revenueQuarter = months.map((m, idx) => {
            const targetMonth = new Date(now.getFullYear(), now.getMonth()- (2-idx), 1).getMonth();
            const sum = orders.filter(o => o.createdAt.getMonth() === targetMonth).reduce((a,b)=>a+b.amount,0);
            return sum;
          });

          // Task report (dummy: lengths per user from logs, last 7 days)
          const users = ['A','B','C','D'];
          const taskReport = users.map((u, i) => ({ avatar: u, done: logs.filter((_,j)=> j%users.length===i && Math.random()>0.3).length, pending: logs.filter((_,j)=> j%users.length===i && Math.random()>0.7).length }));

          return { days, revenue: days.map(d => revenueMap.get(d) || 0), sent: days.map(d => sentMap.get(d) || 0), failed: days.map(d => failedMap.get(d) || 0), funnel, milestone, revenueQuarter, months, taskReport };
        })()
      ]);
      res.write(`data: ${JSON.stringify({ kpis: kpisRes, series: seriesRes })}\n\n`);
    } catch (e) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: (e as any)?.message || 'tick failed' })}\n\n`);
    } finally {
      if (!cancelled) setTimeout(tick, 3000);
    }
  }
  tick();
});

// ---- List customers (simple search) ----
app.get('/api/customers', authRequired, async (req, res) => {
  const q = String((req.query as any).q || '').trim();
  const limit = Math.min(Number((req.query as any).limit || 20), 100);
  const where: any = q ? {
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } }
    ]
  } : {};
  const items = await prisma.customer.findMany({ where, take: limit, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true } });
  res.json(items);
});

// ---- AI: NL -> Rules ----
app.post('/api/ai/nl-to-rules', authRequired, async (req, res) => {
  try {
    const { prompt } = req.body as { prompt: string };
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const lower = prompt.toLowerCase();
    const rules: RulesNode = { op: 'AND', rules: [] };
    const num = (re: RegExp, def: number) => { const m = lower.match(re); return m ? Number(m[1].replace(/[^0-9]/g, '')) : def; };
    if (/inactive|not active|didn'?t shop|haven't shopped/.test(lower)) {
      const days = num(/(\d+)\s*(day|days|d|month|months|m)/, 180);
      const approxDays = /month/.test(lower) ? days * 30 : days;
      rules.rules.push({ field: 'inactiveDays', cmp: '>', value: approxDays } as Rule);
    }
    if (/>\s*₹?\s*?\s*\d+|over|more than/.test(lower) || /spent/.test(lower)) {
      const amt = num(/(\d+[\d,]*)/, 5000);
      rules.rules.push({ field: 'totalSpend', cmp: '>', value: amt } as Rule);
    }
    if (/visits|orders|purchases/.test(lower)) {
      if (/less than|<|under/.test(lower)) {
        const v = num(/(\d+)/, 3);
        rules.rules.push({ field: 'visits', cmp: '<', value: v } as Rule);
      }
    }
    if ((rules.rules as any[]).length === 0) rules.rules.push({ field: 'totalSpend', cmp: '>', value: 10000 } as Rule);
    res.json({ rules });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse prompt' });
  }
});

// ---- AI: Message suggestions ----
app.post('/api/ai/suggest-messages', authRequired, async (req, res) => {
  const { objective, tone } = req.body as { objective?: string; tone?: 'friendly'|'urgent'|'premium' };
  const base = objective || 'bring back inactive users';
  const t = tone || 'friendly';
  const variants = [
    `Hi {{name}}, here’s 10% off your next order—come back and treat yourself!`,
    `{{name}}, we miss you! Enjoy 15% off this week only.`,
    `Exclusive for you, {{name}}: extra 12% savings on your next purchase.`
  ];
  if (t === 'urgent') variants[1] = `{{name}}, last chance—15% off ends tonight!`;
  if (t === 'premium') variants[2] = `{{name}}, enjoy 12% off on handpicked favorites just for you.`;
  res.json({ objective: base, variants });
});

export default app;



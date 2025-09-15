Xeno Mini-CRM

Overview
Xeno Mini-CRM is a lightweight CRM + campaign tool that lets you:
- Build customer segments via rules or natural language (AI-assisted)
- Preview audience size
- Save and send campaigns (simulated vendor)
- View KPIs, time series, and live stats on a dashboard

Monorepo layout
- xeno-mini-crm/apps/web: React + Vite frontend
- xeno-mini-crm/apps/api: Express API with Prisma (MongoDB), optional Redis workers

Key features
- Auth: Google/Firebase login -> JWT for API access
- Segmentation: rule builder and natural-language-to-rules (heuristic AI)
- Campaigns: create campaign, queue/send messages, track sent/failed
- Dashboard: KPIs, 30-day revenue and delivery graphs, funnel, milestones
- Live updates: Server-Sent Events to stream KPIs/series
- Quick ingest: add customers and orders from the UI for demos

AI capabilities
- NL → Rules: POST /api/ai/nl-to-rules converts a prompt (e.g. “haven’t shopped in 6 months and spent over ₹5K”) into structured rules
- Message suggestions: POST /api/ai/suggest-messages returns 2-3 copy variants with tone control

Tech stack
- Frontend: React 18, Vite, Axios, Firebase Web SDK
- Backend: Node.js, Express, Prisma (MongoDB), Zod, JSON Web Tokens, Swagger UI
- Optional: Redis Streams workers (ingestion, sender, receipts)

Local setup
Prerequisites
- Node.js 18+
- MongoDB (connection string)
- Optional: Redis (if you want background workers)
- Firebase project (for Firebase Admin auth path), or use demo auth

1) Clone and install
```
cd xeno-mini-crm/apps/web
npm install

cd ../../api
npm install
```

2) Environment variables (API)
Create xeno-mini-crm/apps/api/.env
```
DATABASE_URL="mongodb+srv://<user>:<pass>@<cluster>/<db>?retryWrites=true&w=majority"
JWT_SECRET="dev_secret"
DEV_SEED_KEY="demo123"

# Optional (Firebase Admin for /auth/firebase)
FB_PROJECT_ID="..."
FB_CLIENT_EMAIL="..."
FB_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Optional Redis (enable background queues)
REDIS_URL="redis://localhost:6379"
# VENDOR_SUCCESS_PCT defaults to 0.9
```

Generate Prisma client
```
cd xeno-mini-crm/apps/api
npm run prisma:generate
```

3) Environment variables (Web)
Create xeno-mini-crm/apps/web/.env.local
```
VITE_API_BASE="http://localhost:8080"

# Firebase Web SDK (for Google login flow)
VITE_FB_API_KEY="..."
VITE_FB_AUTH_DOMAIN="..."
VITE_FB_PROJECT_ID="..."
VITE_FB_APP_ID="..."
VITE_FB_MESSAGING_SENDER_ID="..."
```

4) Run locally
- Start API (dev):
```
cd xeno-mini-crm/apps/api
npm run dev
```
The API starts on http://localhost:8080

- Start Web:
```
cd xeno-mini-crm/apps/web
npm run dev
```
Open http://localhost:5173

5) Demo data
- Use the UI “Seed Demo Data” button. It calls POST /api/dev/seed with header x-seed-key: demo123

Authentication
- Firebase route: UI uses Firebase Web SDK to get an ID token, then exchanges for a JWT at POST /auth/firebase (requires Firebase Admin env vars on API)
- Demo route: POST /auth/demo returns a JWT for local testing if you don’t want Firebase

Key API endpoints
- Auth: POST /auth/firebase, POST /auth/google, POST /auth/demo
- Stats: GET /api/stats, GET /api/stats/series, GET /api/stats/stream (SSE)
- Customers: GET /api/customers
- Ingest: POST /api/ingest/customers, POST /api/ingest/orders
- Segments: POST /api/segments/preview, POST /api/segments
- Campaigns: GET /api/campaigns
- AI: POST /api/ai/nl-to-rules, POST /api/ai/suggest-messages
- Dev: POST /api/dev/seed

Architecture diagram
```
[ Web (React/Vite) ] --Axios--> [ API (Express) ] --Prisma--> [ MongoDB ]
          |                                |\
          |                                | \--(optional)--> [ Redis Streams ] --> [ Workers ]
          |                                |                                   \
          |                                |                                    \-> [ Vendor Sim ]
          |                                \
          \-- Firebase Auth SDK --> [ /auth/firebase ] -- Firebase Admin --> [ Google/Firebase ]

SSE: Web <-- /api/stats/stream (server-sent events) -- API
```

How it works (high-level)
- Sign in with Google via Firebase -> exchange ID token for JWT -> set Authorization header
- Build a segment with rules or generate from natural language
- Preview the audience size via Prisma count
- Save & Send: create segment + campaign, create PENDING logs for matched customers
- Delivery: either enqueue to Redis Streams for workers, or simulate inline vendor calls
- Stats: KPIs and time series computed from orders and communication logs; SSE pushes updates

Trade-offs and decisions
- Simulated AI: NL→rules is deterministic regex/heuristics for predictable demos without external API dependencies
- Vendor simulation: inline vendor endpoint for local realism without third-party creds
- MongoDB with Prisma: flexible JSON rules, quick aggregations; not optimized for huge datasets
- SSE over websockets: simpler to implement and sufficient for periodic updates

Known limitations / assumptions
- AI parsing is heuristic; complex natural language may not map perfectly
- No real email/SMS provider integration; vendor is simulated
- Not multi-tenant; minimal RBAC
- Basic input validation; no rate limiting
- Redis workers optional; without Redis, processing is inline

Deployment notes
- Vercel config provided for static web. Host API elsewhere (e.g., Render/Fly/EC2) and set VITE_API_BASE accordingly
- Protect /api/dev/seed with a secret (DEV_SEED_KEY). Do not enable in production

Developers
- Web scripts: dev, build, preview
- API scripts: dev, worker:ingestion, worker:sender, worker:receipts, prisma:generate
- API docs at /docs (Swagger UI)

Demo script (7 minutes)
Use the script in demo-script.md or below.



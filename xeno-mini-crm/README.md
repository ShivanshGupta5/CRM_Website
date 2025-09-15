# Xeno Mini-CRM (Express + Prisma + MongoDB + Redis + React)

A mini CRM that supports data ingestion, audience segmentation, campaign delivery, delivery receipts, Google OAuth, and an AI-assisted natural-language → rules feature.

- Backend: Express, Prisma, MongoDB, Redis Streams
- Workers: ingestion, sender, receipts
- Frontend: React + Vite
- Auth: Google OAuth (GSI) → backend verifies ID token → issues JWT
- AI: heuristic NL → rules (can be swapped to OpenAI easily)

## Architecture

- API validates input, enqueues to Redis Streams
- Ingestion worker persists to Mongo via Prisma
- Segment creation enqueues per-customer delivery jobs
- Sender worker personalizes message and calls vendor simulator
- Vendor simulator enqueues delivery receipts
- Receipts worker batch-updates `CommunicationLog`
- Google OAuth on frontend; backend issues JWT and protects APIs

## Prerequisites
- Node 18+
- Docker (for MongoDB + Redis)
- npm (or pnpm)

## Environment
Create `xeno-mini-crm/.env` (backend reads it):
```
DATABASE_URL="mongodb://localhost:27017/xeno?directConnection=true"
REDIS_URL="redis://localhost:6379"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
JWT_SECRET="dev_secret_change_me"
# Optional: Firebase Admin (to verify Firebase ID tokens)
# For multiline key from JSON, convert newlines to \n
FB_PROJECT_ID="your-firebase-project-id"
FB_CLIENT_EMAIL="firebase-adminsdk@your-project.iam.gserviceaccount.com"
FB_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
VENDOR_SUCCESS_PCT="0.9" # Set to 0.5 for more failures in demos
```
Create `xeno-mini-crm/apps/web/.env`:
```
VITE_API_BASE="http://localhost:8080"
# Firebase Web SDK config
VITE_FB_API_KEY="..."
VITE_FB_AUTH_DOMAIN="..."
VITE_FB_PROJECT_ID="..."
VITE_FB_APP_ID="..."
VITE_FB_MESSAGING_SENDER_ID="..."
```

## Run locally
```bash
# 1) Infra
cd xeno-mini-crm
docker compose up -d

# 2) Backend
cd apps/api
npm i
npx prisma generate
npm run dev             # API at :8080
# in 3 separate terminals (still in apps/api):
npm run worker:ingestion
npm run worker:sender
npm run worker:receipts

# 3) Frontend
cd ../../apps/web
npm i
npm run dev             # Web at :5173
```

## Demo flow
1) Open the web app at `http://localhost:5173`
2) Sign in with Google (Firebase popup). Backend verifies Firebase ID token and issues JWT
3) Optionally enter a natural-language prompt to generate rules
4) Preview audience size
5) Save campaign (enqueues delivery and logs)
6) Open Campaigns list and Refresh to see sent/failed

## API Endpoints
- `POST /auth/google` `{ idToken }` → `{ token, user }`
- `POST /api/ingest/customers` (auth)
- `POST /api/ingest/orders` (auth)
- `POST /api/segments/preview` (auth)
- `POST /api/segments` (auth)
- `GET /api/campaigns` (auth)
- `POST /api/ai/nl-to-rules` (auth)
- `POST /api/delivery/receipt` (for external vendor sim)
- `POST /vendor/send` (internal vendor simulator)

All protected endpoints expect `Authorization: Bearer <JWT>`.

## Notes / Trade-offs
- NL → rules uses a heuristic parser to remain offline-friendly. Swap to OpenAI by using the `openai` dep and an API key, returning structured rules.
- Auth via Google GSI means no secret flows on the frontend. Backend validates ID token and issues JWT.
- Redis Streams provide at-least-once semantics; workers are idempotent on updates via `updateMany` with PENDING filter.
- For production, use managed MongoDB and Redis with proper credentials and TLS.

## Known limitations
- No Swagger UI included; Postman examples provided
- Vendor simulator is internal; in production this would be an external webhook hitting `/api/delivery/receipt`
- Minimal UI for brevity; can be enhanced with better rule builder UX

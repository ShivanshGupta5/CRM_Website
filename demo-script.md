Xeno Mini-CRM – 7-minute Demo Script

0:00 – 0:30 Intro
- Hi, I’m going to demo Xeno Mini‑CRM, a lightweight tool to build segments, send campaigns, and track outcomes. I’ll cover features, approach, trade‑offs, and AI bits.

0:30 – 1:30 What you’re seeing
- On the left is the dashboard with KPIs: Customers, Orders, Campaigns, and Delivered.
- Below are charts—delivery split, revenue over time, quarterly revenue, milestones, task report, and a simple funnel.
- We support live updates via Server‑Sent Events.

1:30 – 2:15 Sign in
- I’ll click “Sign in with Google”. The web app uses Firebase Web SDK to collect an ID token, and the API verifies it through Firebase Admin to issue a JWT. That JWT is stored and sent on all API calls.

2:15 – 3:00 Seed demo data
- For a quick walkthrough, I’ll use “Seed Demo Data”. This calls a guarded endpoint with a secret header and creates customers and orders.
- Notice KPIs and charts update in near real‑time via SSE.

3:00 – 4:00 Build a segment (rules)
- In the Create Segment card, you can choose AND/OR and add rules like totalSpend > 10000, visits < 3, or inactiveDays > 180.
- Click “Preview Audience” to see how many customers match. This runs a Prisma count with a rules→filter translation.

4:00 – 4:40 Natural language → rules (AI)
- Instead of manual rules, type: “People who haven’t shopped in 6 months and spent over ₹5K”.
- Click “Generate Rules”. The server converts the prompt to structured rules using deterministic parsing. We kept this heuristic to be fast, transparent, and free of external dependencies.

4:40 – 5:30 Create campaign + AI message suggestions
- Name the campaign and enter a message template, or click “Suggest Messages” to get variants (e.g., friendly, urgent, premium tones). I’ll pick one.
- Click “Save & Send”. The API creates the segment and a campaign, then inserts PENDING delivery logs for matching customers.
- Delivery is simulated locally—either enqueued to Redis Streams for workers or sent inline. Results mark logs as SENT or FAILED.

5:30 – 6:30 Dashboard + history
- The dashboard aggregates revenue and delivery status over 30 days, plus a simple funnel and milestones by visits. You can see percentages and totals change as data flows.
- In the Campaigns table at the bottom, you’ll see the new campaign with sent/failed counts.

6:30 – 7:00 Architecture, trade‑offs, and wrap
- Architecture: React/Vite frontend; Express API with Prisma over MongoDB; optional Redis workers; Firebase auth; SSE for live stats.
- Trade‑offs: heuristic AI for predictability; simulated vendor for easy local demos; MongoDB for flexible JSON rules; SSE instead of websockets for simplicity.
- Limitations: no real provider integration, basic auth model, and the AI parser handles common phrasing but not complex grammar.
- That’s the demo—thanks!



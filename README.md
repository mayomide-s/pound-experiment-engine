# AI Coding Story Engine MVP

This repository is the `v1 local MVP` checkpoint for the current internal milestone:

`topic -> idea/script/storyboard -> review pause -> video generation -> asset upload -> quality check -> manual posting package -> completed run`

This release is intentionally focused on a manual workflow:

- Manual posting workflow only
- No auto-posting
- No analytics
- No public signup, billing, or subscriptions
- Optional private access gate for local/private staging only

Current feature scope through v2.1:

- Dashboard run creation and review-aware pipeline tracking
- Idea editing, prompt preview, and critique guidance
- Mock and Runway video generation behind the same provider interface
- Local and Cloudflare R2 asset storage
- Quality checks and recheck flow without re-spending Runway credits
- Idea Queue, manual content calendar, brand defaults, and batch planning controls
- Asset Library, export pack, and manual posting metadata
- Optional private staging access gate with protected APIs and logout

## Stack

- Frontend: React + Vite
- Backend: FastAPI + SQLAlchemy + Alembic
- Queue: Celery + Redis
- Database: PostgreSQL
- Storage: local filesystem or Cloudflare R2
- Video providers: `mock` and `runway`

## Environment Variables

Copy `.env.example` to `.env` and fill in only the mode you intend to run.

Always required:

- `DATABASE_URL`
- `REDIS_URL`
- `VIDEO_PROVIDER`
- `STORAGE_PROVIDER`
- `CORS_ALLOWED_ORIGINS`

Optional for private staging mode:

- `AUTH_ENABLED`
- `APP_ACCESS_PASSWORD`
- `APP_SESSION_SECRET` (recommended for staging, optional for local)

Required for `STORAGE_PROVIDER=r2`:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL`

Required for `VIDEO_PROVIDER=runway`:

- `RUNWAY_API_KEY`

## Private Access Mode

This repo now includes a lightweight private access mode for solo-developer staging.

- `AUTH_ENABLED=false` keeps local development behavior unchanged
- `AUTH_ENABLED=true` enables a simple password gate in the frontend and bearer-token protection on app APIs
- `/health` stays public
- `/health/details` stays safe and secret-free

This is intentionally not full SaaS auth yet:

- No public signup
- No user accounts table
- No OAuth
- No teams/roles
- No subscriptions or billing

## Running Modes

### Local mock mode

- `VIDEO_PROVIDER=mock`
- `STORAGE_PROVIDER=local`
- Cheapest and safest mode for development
- Recommended for smoke testing and UI iteration

### Mock + R2 mode

- `VIDEO_PROVIDER=mock`
- `STORAGE_PROVIDER=r2`
- Uses real R2 uploads without spending Runway credits

### Runway + R2 mode

- `VIDEO_PROVIDER=runway`
- `STORAGE_PROVIDER=r2`
- Real paid generation path

### Private staging mode

- `AUTH_ENABLED=true`
- Set `APP_ACCESS_PASSWORD` to a strong private password
- Set `APP_SESSION_SECRET` for staging if you want the access token signing secret separate from the password
- Set `CORS_ALLOWED_ORIGINS` to your exact frontend origin list, for example `https://staging.example.com`

## Runway Cost Warning

Do not enable `VIDEO_PROVIDER=runway` unless intentional.

- Resume in Runway mode can spend credits
- Bulk Runway generation is intentionally not implemented
- Duplicate Resume is blocked from creating a second provider job for the same run
- If a provider job already exists, the UI should continue existing generation instead of submitting again

## Local Startup

Start everything:

```bash
docker-compose up --build
```

Stop everything:

```bash
docker-compose down
```

The backend seeds `CodeToons AI` automatically on startup if missing.

## Optional Demo Seed

For local mock-only testing, you can add sample queue items and one paused run:

```bash
docker-compose exec backend python -m app.scripts.seed_demo
```

This command is intentionally blocked unless:

- `VIDEO_PROVIDER=mock`
- `STORAGE_PROVIDER=local`

## Create And Resume Runs

Create a run from the UI:

- Open `Dashboard`
- Enter a topic such as `CORS`
- Click `Create Run`

The run will pause at storyboard review in `awaiting_review`.

Resume from the UI:

- Open `Dashboard`
- Select an `awaiting_review` run
- Review prompt/storyboard edits in `Ideas` if needed
- Click `Resume`

Create via API:

```bash
curl -X POST http://localhost:8000/api/pipeline-runs ^
  -H "Content-Type: application/json" ^
  -d "{\"topic\":\"CORS\",\"auto_mode\":false}"
```

Resume via API:

```bash
curl -X POST http://localhost:8000/api/pipeline-runs/RUN_ID/resume ^
  -H "Content-Type: application/json" ^
  -d "{\"review_notes\":\"Approved from dashboard\"}"
```

## Re-Run Quality Check Without Spending Credits

Use this when assets already exist and you only want to re-run review logic:

```bash
curl -X POST http://localhost:8000/api/pipeline-runs/RUN_ID/recheck ^
  -H "Content-Type: application/json" ^
  -d "{\"review_notes\":\"Rechecked after quality logic change\"}"
```

This does not submit a new Runway job.

## Health And Debugging

Basic health:

- `GET /health` -> simple liveness check

Detailed health:

- `GET /health/details` -> DB, Redis, storage, provider, and configuration readiness
- Does not expose secrets
- Drives the in-app environment panel

Useful logs:

```bash
docker-compose logs backend --tail=250
docker-compose logs celery_worker --tail=250
docker-compose logs celery_beat --tail=250
```

## Migration Safety Runbook

Apply migrations:

```bash
docker-compose exec backend alembic upgrade head
```

Inspect current revision:

```bash
docker-compose exec backend alembic current
docker-compose exec backend alembic history --verbose
```

Do not do these unless intentional:

- Do not delete the Postgres volume just to fix a migration mismatch
- Do not hand-edit `alembic_version` without understanding the current revision chain
- Do not rewrite already-applied migrations in a way that breaks existing local databases

## Backup And Preservation Notes

Preserve configuration:

- Keep a copy of `.env`
- Treat `.env` as sensitive and never commit real secrets

Preserve Postgres data:

- Back up the Postgres volume with Docker Desktop or your preferred Docker volume backup flow
- Or run a normal `pg_dump` from the backend/postgres containers

Preserve R2 assets:

- R2 objects are not stored in the Postgres volume
- Keep bucket configuration, credentials, and public base URL documented
- Avoid deleting or rotating buckets without confirming existing asset URLs are still valid

## Troubleshooting

### Backend unavailable in the UI

Check:

- `docker-compose ps`
- `docker-compose logs backend --tail=250`
- `docker-compose logs postgres --tail=250`
- `docker-compose logs redis --tail=250`

If startup fails, the backend now validates configuration early and should log which required settings are missing for the active mode.

### Docker Desktop issues

Common recovery steps:

- Confirm Docker Desktop is fully started
- Re-run `docker-compose up --build`
- Check that Postgres and Redis are healthy before inspecting app-level failures

### Private staging access

If protected API calls return `401`:

- Confirm `AUTH_ENABLED=true` is intentional
- Confirm the frontend origin is included in `CORS_ALLOWED_ORIGINS`
- Confirm `APP_ACCESS_PASSWORD` is set on the backend
- Re-enter the access password in the app if the local access session expired

### Runway mode safety

Before clicking Resume:

- Confirm `VIDEO_PROVIDER=runway` is intentional
- Confirm the run does not already have an approved/completed video
- Confirm you are not trying to bulk-generate paid videos

## Known Safe Commands

```bash
docker-compose up --build
docker-compose down
docker-compose logs backend --tail=250
docker-compose logs celery_worker --tail=250
pytest -q
npm run build
```

## API Surface

- `POST /api/pipeline-runs`
- `GET /api/pipeline-runs`
- `GET /api/pipeline-runs/{id}`
- `POST /api/pipeline-runs/{id}/resume`
- `POST /api/pipeline-runs/{id}/recheck`
- `POST /api/pipeline-runs/{id}/cancel`
- `PATCH /api/pipeline-runs/{id}/idea`
- `PATCH /api/pipeline-runs/{id}/script`
- `PATCH /api/pipeline-runs/{id}/storyboard`
- `GET /api/idea-queue`
- `GET /api/asset-library`
- `GET /health`
- `GET /health/details`

## Campaign Generation Context

Campaign-linked runs stay optional. Legacy runs still use the original Story Engine path, while runs with both `campaign_id` and `creative_variant_id` load a typed campaign generation context before idea, script, storyboard, prompt, narration, and manual-post packaging are built.

The current campaign-aware generation flow uses these variant fields:

- `hook_type`
- `visual_type`
- `tone`
- `call_to_action`
- `video_length_seconds`
- `voiceover_enabled`
- `text_density`
- `tracking_code`
- `experiment_config_json`

Campaign fields such as the core question, campaign description, content rules, target platforms, landing page, and reach metadata also feed the same context. Internal attribution is persisted in existing JSON metadata fields with `generation_context_version=campaign_generation_v1`, while viewer-facing prompts and captions intentionally exclude tracking codes and internal IDs.

Verified performance data is required before any social-proof claim can be generated. If verified values are not supplied in `experiment_config_json`, campaign hooks must avoid numeric participation claims, donor counts, milestones, testimonials, or invented percentages.

To test safely without spending Runway credits, keep `VIDEO_PROVIDER=mock` and run:

```bash
cd backend
pytest -q

cd ../frontend
npm test -- --run
npm run build
```

## Stripe Test Checkout

The public conversion funnel lives at `/experiment` and is disabled by default. Keep `STRIPE_ENABLED=false` for normal local Story Engine work. Stripe configuration is only required when you intentionally enable test Checkout.

Required backend environment variables:

- `STRIPE_ENABLED=true`
- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`
- `PUBLIC_SITE_BASE_URL=http://localhost:5173`
- `PUBLIC_EXPERIMENT_CAMPAIGN_SLUG=the-one-pound-experiment`

Local Stripe test flow:

1. Seed or create the public campaign with slug `the-one-pound-experiment`.
2. Start the backend and frontend locally.
3. If you have Stripe CLI installed, forward webhook events to the backend:

```bash
stripe listen --forward-to http://localhost:8000/api/webhooks/stripe
```

4. Copy the printed signing secret from Stripe CLI into `STRIPE_WEBHOOK_SECRET`.
5. Open `http://localhost:5173/experiment`.
6. Click `Send £1`, complete hosted Checkout, and use this test card in test mode only:

```text
4242 4242 4242 4242
Any future expiry date
Any three-digit CVC
Any valid postal code
```

Important notes:

- The browser redirect to `/experiment/thank-you` is not treated as payment confirmation.
- Payment completion is only confirmed after the signed `checkout.session.completed` webhook is verified and stored.
- The public status endpoint exposes only safe session status fields, never card data, Stripe secrets, or raw webhook payloads.
- Production readiness is still outstanding for areas like live-mode activation, tax handling, emails, analytics, fraud controls, and operational monitoring.

## Development Checks

Backend:

```bash
cd backend
pytest -q
```

Frontend:

```bash
cd frontend
npm run build
```

## Security And Logging Notes

- Prompt logs redact secrets, API keys, access tokens, signed URLs, and provider credentials before persistence
- Health details report readiness and missing setting names only, never secret values
- `VIDEO_PROVIDER=mock` remains the safest default for development
- Never commit `.env`, real `APP_ACCESS_PASSWORD`, `APP_SESSION_SECRET`, Runway keys, or R2 credentials
- The private access gate is meant for private staging only, not public launch or multi-user SaaS auth

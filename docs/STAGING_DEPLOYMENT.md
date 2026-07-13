# Staging Deployment Preparation

This repository is prepared for a staging deployment with:

- Render Web Service for the FastAPI backend
- Render PostgreSQL for application data
- Vercel for the Vite frontend
- Stripe test-mode Checkout webhooks

This document intentionally stops before resource creation. It prepares the repository-side configuration and lists the dashboard steps still required.

Environment precedence:

- `APP_ENV` takes precedence when set
- otherwise `ENVIRONMENT` is used
- if neither is set, the backend defaults to `development`

## Existing Infrastructure

Already present in the repository:

- Docker-based local and VPS-oriented deployment files:
  - `docker-compose.yml`
  - `docker-compose.prod.example.yml`
  - `docker-compose.staging.local.yml`
  - `docker-compose.vps.prod.yml`
- Alembic migrations in `backend/alembic`
- Public health endpoints:
  - `GET /health`
  - `GET /health/details`
- Stripe public checkout and webhook handling:
  - `POST /api/public/checkout-sessions`
  - `POST /api/webhooks/stripe`
- Frontend API base URL support through `VITE_API_BASE_URL`
- CI workflow in `.github/workflows/ci.yml`

No existing repository-side configuration for Render or Vercel was present before this staging prep.

## Recommended Staging Architecture

Backend:

- Platform: Render Web Service
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
```

- Health check path: `/health`
- Pre-deploy command:

```text
sh scripts/render_predeploy.sh
```

Database:

- Platform: Render PostgreSQL
- Blueprint plan: `basic-256mb`
- Connect the backend with `DATABASE_URL`
- Prefer the internal Render connection string when the service and database live in the same Render region
- If you must use an external Postgres URL, include `sslmode=require` when Render requires SSL

Frontend:

- Platform: Vercel
- Root directory: `frontend`
- Install command: default Vercel npm install flow
- Build command: `npm run build`
- Output directory: `dist`

## Backend Deployment Notes

The backend now normalizes Postgres connection URLs so these forms work with the installed `psycopg` driver:

- `postgresql+psycopg://...`
- `postgresql://...`
- `postgres://...`

This matters because managed providers often expose a `postgres://` or `postgresql://` connection string, while SQLAlchemy in this repo is configured to use `psycopg`.

Unsupported schemes are left unchanged. The normalization does not append `+psycopg` twice.

The Render-specific startup path does not rely on `backend/start.sh`, so migrations and seeding are no longer hidden inside service startup for staging. They run as an explicit pre-deploy step instead.

## Migration And Seed Procedure

Render-safe pre-deploy command:

```text
sh scripts/render_predeploy.sh
```

That script runs:

```text
alembic upgrade head
python -m app.scripts.seed_pound_experiment
```

Why this is the recommended staging flow:

- migrations run before new code serves traffic
- failures are visible to Render as deploy failures
- the public campaign seed is idempotent by slug
- no destructive commands run on every request
- application startup remains focused on serving traffic

If you prefer to avoid automatic pre-deploy execution, the safe manual one-off sequence is:

```text
cd backend
alembic upgrade head
python -m app.scripts.seed_pound_experiment
```

Do not run this concurrently from multiple manual terminals against the same staging deploy.

## Required Render Environment Variables

Set these on the Render backend service:

- `APP_ENV=staging`
- `DATABASE_URL`
- `VIDEO_PROVIDER=mock`
- `STORAGE_PROVIDER=local`
- `PUBLIC_SITE_BASE_URL=https://STAGING-FRONTEND.vercel.app`
- `PUBLIC_EXPERIMENT_CAMPAIGN_SLUG=the-one-pound-experiment`
- `STRIPE_ENABLED=true`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CORS_ALLOWED_ORIGINS=https://STAGING-FRONTEND.vercel.app`

Optional but recommended for consistency:

- `AUTH_ENABLED=false` for a public experiment-only staging flow
- `REDIS_URL` only if you plan to exercise queue-backed features in staging

Notes:

- `GET /health` is the recommended Render health check because it stays lightweight and does not depend on Redis or other optional subsystems.
- `GET /health/details` is useful for human debugging.
- If `REDIS_URL` is unset, Redis appears as `disabled`.
- If `REDIS_URL` is set and Redis is unreachable, health details report Redis as an error.

## Required Vercel Environment Variables

Set these on the Vercel frontend project:

- `VITE_API_BASE_URL=https://STAGING-BACKEND.onrender.com/api`

The frontend already reads `VITE_API_BASE_URL` from the existing code path in `frontend/src/api/client.ts`.

## Frontend Routing Notes

`frontend/vercel.json` is included so direct loads and refreshes continue to work for SPA routes such as:

- `/experiment`
- `/experiment/thank-you`
- `/experiment/cancelled`

This prevents Vercel from returning a 404 on client-side routes that should resolve to the SPA entrypoint.

## Stripe Staging Configuration

Expected backend webhook endpoint:

```text
https://STAGING-BACKEND.onrender.com/api/webhooks/stripe
```

Relevant Stripe test-mode events handled by the current backend:

- `checkout.session.completed`
- `checkout.session.expired`

No broader event subscription is required for the current public experiment payment flow.

Expected frontend redirect URLs generated by the backend:

```text
https://STAGING-FRONTEND.vercel.app/experiment/thank-you?session_id={CHECKOUT_SESSION_ID}
https://STAGING-FRONTEND.vercel.app/experiment?checkout=cancelled
```

## Manual Dashboard Steps Still Required

Render:

- Create or sync the backend service from `render.yaml`
- Confirm the service root directory is `backend`
- Confirm the health check path is `/health`
- Create or attach the Render PostgreSQL database
- Fill in secret environment variables:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `PUBLIC_SITE_BASE_URL`
  - `CORS_ALLOWED_ORIGINS`
- Run the first deploy and confirm the pre-deploy command succeeds

Vercel:

- Create the frontend project with root directory `frontend`
- Use the existing npm install flow
- Set the build command to `npm run build`
- Set the output directory to `dist`
- Set `VITE_API_BASE_URL` to the Render backend API URL
- Confirm direct loads of `/experiment`, `/experiment/thank-you`, and `/experiment/cancelled`

Stripe:

- Create a test-mode webhook endpoint pointing to the Render backend URL
- Subscribe only to:
  - `checkout.session.completed`
  - `checkout.session.expired`
- Copy the generated signing secret into `STRIPE_WEBHOOK_SECRET`

## Cost And Free-Tier Notes

Expected staging costs depend on current vendor pricing at deploy time.

Operational expectations:

- Render web services may require a paid instance depending on current plan availability and sleep-policy needs
- Render PostgreSQL commonly incurs recurring cost even at small staging sizes
- Vercel hobby-tier hosting is often sufficient for a staging Vite SPA, but bandwidth and team limits still apply
- Stripe test mode itself does not charge card-processing fees for test transactions

Verify current pricing in the vendor dashboards before provisioning.

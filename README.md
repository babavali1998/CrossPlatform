# CrossPlatform

Write a post once, pick which of your connected accounts it goes to, and publish to all of them with one click. Each platform gets its own preview and its own editable version, and you can have AI adapt the text per platform before anything is sent.

Built with Next.js 16, TypeScript, Tailwind, Prisma 7 + PostgreSQL, Auth.js, BullMQ + Redis, S3-compatible storage and the OpenAI API.

## What works today

| Platform | Publishing | Media | Analytics | What you need |
| --- | --- | --- | --- | --- |
| Instagram | Feed posts, carousels (up to 10), Reels, Stories | Photos (PNG/WebP converted to JPEG), video | Views, reach, likes, comments, shares, saves, followers | Professional account + Meta app. Only app testers can publish until Meta approves Advanced Access. |
| Threads | Text, single photo/video, carousels (up to 20) | Photos, video | Views, likes, replies, reposts, followers | Meta app with the Threads use case. Testers only until approved. |
| X | Text, up to 4 photos or 1 video | Photos, GIF, video | Off by default (X bills every read) | X developer app. X API is pay-per-use. |
| LinkedIn | Text, 1 or more photos, to your personal profile | Photos | Not available to standard apps | LinkedIn app with "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" (both self-serve). |
| Facebook, TikTok, YouTube, Pinterest, Bluesky | Not yet | | | Shown in the app as "Coming later". They can't be selected. |

Everything above uses the platforms' official APIs and OAuth. There is no scraping, browser automation, or mock publishing. If a platform rejects a post, you see the platform's own error.

Things that are deliberately not done yet:
- LinkedIn video and Company Page posting (Pages need LinkedIn's Community Management API approval).
- Instagram shopping tags, music, collaborators and first comments.
- Recurring posts repeat the same content on a daily, weekly or monthly schedule. There's no content rotation.

## Features

- **Composer**: one editor for text, photos and video (direct-to-storage uploads with progress), with a lane per connected account. Each lane shows a live character meter against that platform's real counting rules (X weights links and emoji, Threads counts emoji by bytes), plus a Ready / Needs changes status.
- **Original or AI optimized**: send the same text everywhere, or generate a version per platform with OpenAI, then review and edit each one. Nothing AI-written is published without you seeing it.
- **Previews** per platform, and **Select all / Deselect all**.
- **Publish now, schedule, or save as a draft**, with optional daily, weekly or monthly repeats. The calendar shows everything that's scheduled.
- **Results page**: per-platform status with direct links to the live posts. If one platform fails, the rest still publish, and "Retry failed" re-sends only the failed ones.
- **Bulk upload** from CSV, with a row-by-row check before importing.
- **Analytics** from platforms that share them: views, likes, comments, shares, reach, engagement rate, follower growth and top posts.
- **Accounts**: connect several accounts per platform, see connection status, reconnect expired ones and disconnect.

## Reliability

- Each post on each account is its own queue job, with an id derived from the target and retry round. Double clicks and scheduler races can't enqueue it twice.
- A target that reached Published is never sent again.
- Progress is saved as it happens (Instagram/Threads container ids, X media ids, LinkedIn image URNs), so a retry resumes instead of re-uploading or creating a duplicate container.
- The final "create post" call is tracked. If it times out with no answer, the next attempt checks the platform first: Meta containers report whether they were published, and X is searched for the post. LinkedIn can't be checked, so that case stops as "outcome unknown" until you confirm by hand.
- Retries use exponential backoff (30s, 1m, 2m...), and honor `Retry-After` and X's rate-limit reset headers.
- Expired or revoked tokens flag the account as "Reconnect needed" instead of failing silently. Tokens are refreshed before they expire (X every 2 hours, Meta's 60-day tokens weekly).
- OAuth tokens are encrypted at rest with AES-256-GCM. OAuth uses a single-use `state` (plus PKCE for X).
- Every attempt is written to a per-post publishing log you can open from the results page.

## Quick start (local)

Requirements: Node 20.9+, Docker (for Postgres, Redis and MinIO).

```bash
git clone https://github.com/babavali1998/crossplatform && cd crossplatform
cp .env.example .env
# Fill in TOKEN_ENCRYPTION_KEY and AUTH_SECRET:
#   openssl rand -base64 32
# Set ALLOW_DEV_LOGIN=true to sign in locally without Google/GitHub.

docker compose up -d
npm install            # also runs `prisma generate`
npx prisma migrate deploy

npm run dev            # web app on http://localhost:3000
npm run worker         # in a second terminal: publishing + scheduling + analytics
```

MinIO needs CORS so the browser can upload straight to it. In the MinIO console (http://localhost:9001, minioadmin/minioadmin), or with `mc`, allow `PUT` and `GET` from `http://localhost:3000` on the `crossplatform` bucket.

### Connecting Instagram and Threads locally

Meta downloads your media from a URL and requires https redirect URIs, so localhost alone won't work for those two:

1. Expose the app with a tunnel, for example `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, and set `APP_URL` to the https URL.
2. Make media publicly reachable: point `S3_PUBLIC_BASE_URL` at a public bucket/CDN (Cloudflare R2 with a public domain works well), or use real S3 so the 6-hour presigned URLs are reachable.

X and LinkedIn work with `http://localhost:3000` redirect URIs.

## Platform setup

Register this redirect URI for each platform:

```
{APP_URL}/api/connect/<platform>/callback      # instagram | threads | x | linkedin
```

The Accounts page shows the exact URI and each platform's requirements.

**Instagram**: In Meta for Developers, create an app, add **Instagram** → *API setup with Instagram login*. Copy the Instagram app ID and secret to `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`. Add the redirect URI under *Business login settings*. Permissions: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`. Until App Review grants Advanced Access, add your Instagram account as a tester under *App roles*. The account must be Business or Creator.

**Threads**: Create a Meta app with the **Access the Threads API** use case. Copy the Threads app ID and secret to `THREADS_APP_ID` / `THREADS_APP_SECRET`, and add the redirect URI. Permissions: `threads_basic`, `threads_content_publish`, `threads_manage_insights`. Add yourself as a Threads tester until the app is approved.

**X**: In the X Developer Console, create a Project and an App. Turn on OAuth 2.0 with type **Web App**, add the callback URI, and copy the Client ID / Client Secret to `X_CLIENT_ID` / `X_CLIENT_SECRET`. Scopes requested: `tweet.read tweet.write users.read media.write offline.access`. X API access is pay-per-use. As of October 2026 a post cost about $0.015, or $0.20 with a link. Check your console for current prices. Set `X_ENABLE_METRICS=true` only if you're fine paying for analytics reads.

**LinkedIn**: Create an app at developer.linkedin.com and add the **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** products. Copy the client ID/secret to `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` and add the redirect URI. LinkedIn tokens last 60 days. Standard apps get no refresh token, so the account shows "Reconnect needed" when it expires.

**OpenAI** (optional): set `OPENAI_API_KEY`. `OPENAI_MODEL` defaults to `gpt-4.1-mini`.

## Deployment

The web app and the worker are separate processes that share one database, one Redis and one bucket.

**Web on Vercel**
1. Import the repo into Vercel. The build runs `prisma generate` through `postinstall`.
2. Add every variable from `.env.example`. Use a hosted Postgres (Neon, Supabase, RDS), hosted Redis (Upstash, Redis Cloud) and an S3-compatible bucket (S3, R2).
3. Set `APP_URL` to the production URL and configure at least one login provider (`AUTH_GOOGLE_*` or `AUTH_GITHUB_*`). Set `ALLOWED_EMAILS` to your own email to keep the app private.
4. Configure the bucket's CORS to allow `PUT` from your `APP_URL`.

**Worker on Railway / Render / Fly.io**: Vercel functions can't run a long-lived queue worker. Deploy `Dockerfile.worker` with the same environment variables. It runs `prisma migrate deploy` and then the worker. One instance is enough to start. `WORKER_CONCURRENCY` controls parallel publishes.

If the worker isn't running, posts stay "Queued" and scheduled posts don't go out.

## Architecture

```
src/
  app/(app)/…            dashboard pages (compose, scheduled, published, drafts, bulk, analytics, assistant, accounts, settings)
  app/api/…              route handlers (posts, media, connect/[platform], accounts, ai, analytics, settings)
  components/composer/   composer, previews, direct uploads
  lib/platforms/
    catalog.ts           client-safe limits, formats and requirements per platform
    validate.ts          shared content checks (composer + API)
    adapters/*.ts        OAuth + publish + metrics per platform
    registry.ts          adapter lookup
  lib/publisher.ts       dispatch, idempotent execution, retries, recurrence, scheduler sweep
  lib/queue.ts           BullMQ queues
  worker/index.ts        the worker process
prisma/schema.prisma     data model (Post → PostTarget per account → PublishLog / MetricSnapshot)
```

### Adding a platform

1. Write `src/lib/platforms/adapters/<name>.ts` implementing `PlatformAdapter` (`buildAuthUrl`, `exchangeCode`, `fetchProfile`, `publish`, and optionally `refresh`, `reconcile`, `fetchPostMetrics`, `fetchFollowers`).
2. Fill in its entry in `catalog.ts` (limits, media rules, requirements, `envKeys`) and change `status` to `"available"`.
3. Register it in `registry.ts` and add its env vars to `.env.example`.

The composer, validation, queue, retries and results page pick it up automatically.

## Testing

```bash
npm test          # unit + adapter contract tests + publisher integration tests
npm run lint
npm run typecheck
```

- Adapter tests run each adapter against a fake HTTP layer and check that it calls the documented endpoints in order. They don't contact real platforms.
- Publisher tests run against the Postgres in `DATABASE_URL`. They cover partial failure, retrying only failed targets, ambiguous timeouts, reconciliation, auth failures, and scheduled + recurring dispatch.
- CI (`.github/workflows/ci.yml`) also checks that `prisma/migrations` matches `schema.prisma`.

Before relying on a platform, test it for real with your own account: connect it, publish a test post, and check the link on the results page.

## Environment variables

See `.env.example`. Every variable is documented there.

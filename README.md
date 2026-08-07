# AI Agent Pro API (v2.52.0-firebase)

Public API + Team OS engine. Firebase + Gmail SMTP ready for Render.

## Quick start (local)

```bash
npm install
npm start
# http://localhost:3000
# Health: GET /api/health  or  /api/v1/health
```

## Env (already in `.env`)

- SMTP: Gmail (`newgenerationbox506@gmail.com`)
- Firebase project: `rg-tournament-ccd7d`
- Service account: `firebase-service-account.json`

## Render

1. Connect this private repo
2. Build: `npm install`
3. Start: `npm start`
4. Env vars already listed in `render.yaml` (or set from dashboard)

## Firebase

- Admin SDK initializes on boot
- Health endpoint shows Firebase status
- Collections ready: users, providers, conversations, messages, payments, plans, announcements, otps, settings

## Notes

- First registered user becomes **admin**
- Digital Twin + workspace tools run on real disk
- Secrets are in repo for testing (private repo). Change later.

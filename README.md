# AI Agent Pro API (Server only)

Backend API + Firebase Firestore.

## Stack
- Express + TypeScript (tsx)
- Firebase Admin (credentials: `Tiktok.txt`)
- SMTP email (env)
- Auth / plans / billing / workspace / agent engine

## Run
```bash
npm install
npm start
# GET /api/health
# /api/v1/*
```

## Not in this repo
- Load balancer + Central Admin → **aap-control-plane**
- Frontend / APK → separate later

## Owner admin (seed on boot)
`OWNER_ADMIN_EMAIL` / `OWNER_ADMIN_PASSWORD` env

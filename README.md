# PlusDo (React + TypeScript + EAS)

This project is rebuilt from scratch with:

- Frontend: Expo (React Native + TypeScript) in `apps/mobile`
- Backend: Express (TypeScript) in `apps/server`

## Quick Start

1. Install root tooling
   - `npm install`
2. Install backend dependencies
   - `npm --prefix apps/server install`
3. Mobile dependencies are already in `apps/mobile` from scaffold.

Run both frontend + backend:

- `npm run dev`

Run separately:

- Backend: `npm run server`
- Mobile: `npm run mobile`

## Backend Environment

Create `apps/server/.env`:

```bash
PORT=8787
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

Without `OPENAI_API_KEY`, `/api/organize` returns a clear error.

## EAS

Mobile EAS config lives at `apps/mobile/eas.json`.

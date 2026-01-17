# Repository Guidelines

## Project Structure & Module Organization
- `App.tsx`, `index.tsx`, `index.css`: Vite React app entry points and global styles.
- `components/`, `contexts/`, `services/`, `utils/`: shared UI, state, API clients, and helpers.
- `backend/`: Node/Express API (`index.js`, `db/`, `scripts/`, `db.js`, `logger.js`).
- `deploy/` and `docker-compose.yml`: production container setup (Caddy, Nginx, Postgres).
- `backups/`, `logs/`: runtime artifacts; avoid committing generated files.

## Build, Test, and Development Commands
- `npm install`: install frontend dependencies.
- `npm run dev`: run Vite dev server on `http://localhost:3000`.
- `npm run build`: build frontend production assets.
- `npm run preview`: serve the built frontend locally.
- `cd backend && npm install`: install backend dependencies.
- `cd backend && npm start`: run API on `http://localhost:3001`.
- `docker compose up -d --build`: build and run full stack with Caddy/Postgres.

## Coding Style & Naming Conventions
- TypeScript + React with Vite; prefer functional components and hooks.
- Use existing indentation and formatting in each file (currently 2 spaces in TS/TSX).
- Component files and exports use `PascalCase` (e.g., `components/ErrorBoundary.tsx`).
- Non-component utilities use `camelCase` file names (e.g., `services/logging.ts`).
- No lint/format scripts are configured; keep diffs minimal and consistent.

## Testing Guidelines
- No automated test framework is configured in this repo.
- If adding tests, document the tooling and add an `npm test` script in `package.json`.

## Commit & Pull Request Guidelines
- Recent commits use short, direct messages (Portuguese and English); keep them concise.
- PRs should include: a clear summary, linked issue (if any), and screenshots for UI changes.
- Note any required environment variables or migrations in the PR description.

## Configuration & Environment
- Frontend expects `.env.local` with `VITE_API_BASE_URL` (see `README.md`).
- Backend expects `backend/.env` with `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`.
- Initialize Postgres with `backend/db/init.sql` before first run.

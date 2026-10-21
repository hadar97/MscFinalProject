# BookBridge – website (Next.js)

The website of BookBridge. It signs users in with Neon Auth and talks to the
BookBridge API (`server/server.js`) with the user's login token.

## Run locally

1. `cd web`
2. `npm install`
3. Copy `.env.local.example` to `.env.local` and fill in the values
4. In another terminal, from the project root: `node server/server.js`  (the API, port 3001)
5. `npm run dev` and open http://localhost:3000

## Pages

| Page | What it does | API |
| --- | --- | --- |
| `/` | Landing page | – |
| `/auth/sign-in`, `/auth/sign-up` | Neon Auth, email + password | Neon Auth |
| `/onboarding/genres` | Questionnaire 1: choose 3–5 genres | `GET /api/onboarding/questionnaire` |
| `/onboarding/rate` | Questionnaire 2: rate ~20 books, save | `POST /api/onboarding/books`, `POST /api/me/onboarding` |
| `/for-you` | 10 picks + “available near me” (filter / boost) | `GET /api/me/recommendations` |
| `/books/[id]` | Book: rating, save, finished, where to borrow, similar books | `/api/books/:id`, `/similar`, `/availability`, `/api/me/ratings`, `/api/me/events` |
| `/search` | Search by title | `GET /api/books/search` |
| `/shelf` | Rated / Saved / Finished | `/api/me/ratings`, `/api/me/shelf` |
| `/account` | Profile | `GET /api/me` |
| `/chat`, `/insights` | Coming soon (model 2, reading insights) | – |

## Files

| File | Role |
| --- | --- |
| `app/globals.css` | Colors, fonts and shared button/card styles (“autumn library”) |
| `components/` | Header, Logo, Leaf, Cover, Stars, RecCard, AppShell… |
| `lib/auth/server.js`, `lib/auth/client.js` | Neon Auth (server side / browser) |
| `app/api/auth/[...path]/route.js` | All Neon Auth requests go through here |
| `proxy.js` | Pages that require sign-in |
| `lib/api.js` | `api(path, options)` – calls the BookBridge API with the login token |

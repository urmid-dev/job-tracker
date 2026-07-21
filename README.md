# JobTrack AI

**Live demo: [job-tracker-production-a928.up.railway.app](https://job-tracker-production-a928.up.railway.app/)**

A personal job-application tracker with AI-powered resume/ATS scoring and
optional Gmail auto-sync.

## Features

- **Job board** — track company, role, status (applied / interview /
  rejected / offer), and applied date, with a per-job status timeline.
- **AI ATS review** — paste a job description and your resume gets scored
  against it (Groq/Llama): missing keywords, ATS compatibility issues,
  bullet-by-bullet rewrite suggestions with keyword/word-count deltas, and a
  visa-sponsorship signal, plus a highlighted PDF viewer showing exactly
  which resume phrases the rewrites reference.
- **Gmail auto-sync** *(owner-only)* — once a day, scans the inbox for
  rejection/interview emails and automatically updates the matching job's
  status. This is a single-owner feature, not per-user: hooking every user's
  own Gmail up would require Google's OAuth app-verification review for a
  restricted scope (`gmail.readonly`), which isn't practical for a small
  personal project.
- **Multi-user accounts** — anyone can sign up (email + password); each
  account only ever sees its own jobs and resumes.

## Tech stack

- **Client**: React 19 + Vite + Tailwind CSS
- **Server**: Express 5 + better-sqlite3, session-based auth (bcrypt-hashed
  passwords), Groq SDK for scoring, Google APIs client for Gmail

## Local setup

Requires Node 18+.

```bash
git clone <this-repo-url>
cd job-tracker
npm install --prefix client
npm install --prefix server
```

Create `server/.env`:

```
GROQ_API_KEY=your-groq-api-key

# Optional — only needed if you want Gmail auto-sync
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/callback

# The account that signs up with this email becomes the owner — the only
# account allowed to connect Gmail. If omitted, the very first account ever
# created becomes the owner.
OWNER_EMAIL=you@example.com

# Any long random string; used to sign session cookies
SESSION_SECRET=some-long-random-string
```

Run client and server separately in dev:

```bash
npm run dev --prefix server   # http://localhost:3001
npm run dev --prefix client   # http://localhost:5174
```

Then open `http://localhost:5174` and sign up — the account matching
`OWNER_EMAIL` gets Gmail sync.

## Production build

From the repo root:

```bash
npm run build   # builds the client, installs server deps
npm start        # serves the built client + API from one process on $PORT
```

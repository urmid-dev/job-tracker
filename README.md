# JobTrack AI

**Live demo: [job-tracker-production-a928.up.railway.app](https://job-tracker-production-a928.up.railway.app/)**

A personal job-application tracker with AI-powered resume/ATS scoring and
optional Gmail auto-sync.

## Features

- **Job board** — track company, role, status (applied / interview /
  rejected / offer), and applied date, with a per-job status timeline.
- **AI ATS review** — paste a job description and your resume gets scored
  against it (Groq, `openai/gpt-oss-120b`): missing keywords, ATS compatibility issues,
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

## AI guardrails & evals

Two LLM call sites: resume/JD scoring (`server/groq.js`) and Gmail email
classification (`server/gmail.js`), both via Groq. The model is set in one place (`server/llm.js`) and can be overridden with `GROQ_MODEL`.

**Guardrails:**
- **Output schema validation** (`server/schemas.js`, [zod](https://zod.dev/))
  — every model response is validated against a strict schema (exact enum
  values, correct types) before the app uses it. Without this, a drifted or
  malformed response (e.g. wrong casing on a classification) could have been
  written straight into the database.
- **Prompt-injection framing** — resume text, job descriptions, and email
  bodies are wrapped in explicit delimiters with an instruction telling the
  model to treat that content strictly as data, never as instructions.
- **Confidence-gated human-in-the-loop** — Gmail only *auto-applies* a
  status change on a high-confidence classification; low-confidence matches
  become a pending suggestion the owner has to manually accept or dismiss.
- **Pre-filtering before the LLM runs** — incoming emails are matched
  against tracked companies first, so the classifier only ever runs on
  plausibly-relevant messages.
- **Deterministic correction of LLM output** — rewritten resume bullets are
  verified to match the original's word count; if the model misses after a
  few retries, a non-AI fallback forcibly corrects it rather than shipping
  a wrong count.
- **Per-user rate limiting** ([express-rate-limit](https://express-rate-limit.mintlify.app/))
  on both LLM-cost routes, so no single account can run up unlimited API
  usage.
- **Graceful degradation** — if scoring fails for any reason, the job is
  still created without a score instead of the whole request failing.

**Evals** (`server/evals/run.js`, run manually via `npm run eval` in
`server/` — calls the real Groq API against a small fixed set of resume/JD
and email examples, so it costs a little real usage and isn't part of the
automatic test suite):
- Resume scoring: a strong-match JD scores high, a clearly unrelated JD
  scores low, and a minimal JD doesn't crash — all checked against the zod
  schema.
- Email classification: an explicit rejection and an explicit interview
  invite are classified correctly with high confidence; a generic
  "we received your application" acknowledgment and an unrelated newsletter
  are correctly recognized as non-decisions.

Schema-validation guardrails are also covered by free, mocked, automatic
unit tests in `server/test/guardrails.unit.test.js` (part of `npm test`).

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
# Optional — override the Groq model (default: openai/gpt-oss-120b)
# GROQ_MODEL=openai/gpt-oss-120b

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

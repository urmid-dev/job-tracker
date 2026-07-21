import os from 'os';
import path from 'path';
import fs from 'fs';

// Runs once per test file, before that file's own imports execute — this is
// what lets db.js/gmail.js pick up a fresh, isolated path instead of the real
// jobs.db / gmail_token.json used by the actual running app.
const uniqueId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(os.tmpdir(), `jobtracker-test-${uniqueId}.db`);
process.env.GMAIL_TOKEN_PATH = path.join(os.tmpdir(), `jobtracker-test-token-${uniqueId}.json`);

// Defensive placeholders so tests never depend on the real .env — dotenv
// only fills in vars that aren't already set, so these values win.
process.env.GROQ_API_KEY ||= 'test-groq-key';
process.env.GOOGLE_CLIENT_ID ||= 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET ||= 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI ||= 'http://localhost:3001/api/gmail/callback';
process.env.SESSION_SECRET ||= 'test-session-secret';
// Fixed so tests can deterministically sign up "the owner" regardless of
// what order other accounts happen to be created in within the same file.
process.env.OWNER_EMAIL ||= 'owner@example.com';

afterAll(() => {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.rmSync(process.env.DB_PATH + suffix); } catch {}
  }
  try { fs.rmSync(process.env.GMAIL_TOKEN_PATH); } catch {}
});

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import db from './db.js';
import multer from 'multer';
import cron from 'node-cron';
import { scoreJob, getResumeText } from './groq.js';
import { parseJobUrl } from './scraper.js';
import { buildHighlightedPdf } from './highlight.js';
import { isConnected, getConnectedEmail, getLastSync, getAuthUrl, handleOAuthCallback, runSync, disconnect } from './gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESUMES_DIR = process.env.RESUMES_DIR || path.join(__dirname, 'resumes');
fs.mkdirSync(RESUMES_DIR, { recursive: true });

const app = express();

// Same-origin in production (server serves the built client), so this mainly
// matters for local dev where the Vite server runs on a different port.
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5174',
  credentials: true,
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// Multi-user accounts: each user signs up with email/password and only ever
// sees their own jobs/resumes. Gmail sync stays a single owner-only feature
// (see requireOwner) to avoid Google's OAuth app-verification requirement
// that kicks in once a gmail.readonly app serves multiple outside accounts.
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireOwner(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.session.isOwner) return res.status(403).json({ error: 'Owner access required' });
  next();
}

app.post('/api/auth/signup', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const { n: userCount } = db.prepare('SELECT COUNT(*) as n FROM users').get();
  const isOwner = userCount === 0 || (process.env.OWNER_EMAIL && email === process.env.OWNER_EMAIL.trim().toLowerCase());

  const password_hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash, is_owner) VALUES (?, ?, ?)')
    .run(email, password_hash, isOwner ? 1 : 0);
  const userId = info.lastInsertRowid;

  // Carries over jobs/resumes that predate multi-user accounts (all had a
  // NULL user_id) into the owner's new account, once.
  if (isOwner) {
    db.prepare('UPDATE jobs SET user_id = ? WHERE user_id IS NULL').run(userId);
    db.prepare('UPDATE resumes SET user_id = ? WHERE user_id IS NULL').run(userId);
  }

  req.session.userId = userId;
  req.session.isOwner = Boolean(isOwner);
  req.session.email = email;
  res.json({ success: true, email, isOwner: Boolean(isOwner) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  req.session.userId = user.id;
  req.session.isOwner = Boolean(user.is_owner);
  req.session.email = user.email;
  res.json({ success: true, email: user.email, isOwner: Boolean(user.is_owner) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/status', (req, res) => {
  if (!req.session?.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, email: req.session.email, isOwner: Boolean(req.session.isOwner) });
});

// Resume upload — each upload is saved as its own file and kept as a
// selectable version; nothing is overwritten.
const upload = multer({
  storage: multer.diskStorage({
    destination: RESUMES_DIR,
    filename: (req, file, cb) => cb(null, `resume-${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`),
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are accepted'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Resolves a resume DB row: by id if given, otherwise the caller's active one.
// Always scoped to userId so one account can never reach another's resume.
function getResumeRow(id, userId) {
  if (id) return db.prepare('SELECT * FROM resumes WHERE id = ? AND user_id = ?').get(id, userId);
  return db.prepare('SELECT * FROM resumes WHERE is_active = 1 AND user_id = ?').get(userId);
}

// Logs a status transition so the dashboard can show a per-job timeline.
// source: 'system' (job created) | 'manual' (user changed it) | 'gmail' (auto-detected)
// occurredAt lets gmail-sourced entries backdate to the email's real date
// instead of whenever the sync/accept happened to run.
function recordStatusChange(jobId, status, source, detail = null, occurredAt = null) {
  const when = occurredAt || new Date().toISOString();
  db.prepare('INSERT INTO job_status_history (job_id, status, source, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(jobId, status, source, detail, when);
  db.prepare('UPDATE jobs SET status_updated_at = ? WHERE id = ?').run(when, jobId);
}

app.post('/api/resume', requireAuth, upload.single('resume'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required' });

  db.prepare('UPDATE resumes SET is_active = 0 WHERE user_id = ?').run(req.session.userId);
  const info = db.prepare(
    'INSERT INTO resumes (filename, original_name, is_active, user_id) VALUES (?, ?, 1, ?)'
  ).run(req.file.filename, req.file.originalname, req.session.userId);

  res.json({ success: true, id: info.lastInsertRowid, filename: req.file.originalname, size: req.file.size });
});

// List all uploaded resume versions, most recent first
app.get('/api/resumes', requireAuth, (req, res) => {
  const resumes = db.prepare('SELECT * FROM resumes WHERE user_id = ? ORDER BY uploaded_at DESC').all(req.session.userId);
  res.json(resumes.map(r => {
    const filePath = path.join(RESUMES_DIR, r.filename);
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : null;
    return {
      id: r.id,
      original_name: r.original_name,
      uploaded_at: r.uploaded_at,
      is_active: Boolean(r.is_active),
      size,
    };
  }));
});

// Mark a previously uploaded resume version as the active one
app.post('/api/resumes/:id/activate', requireAuth, (req, res) => {
  const resume = getResumeRow(req.params.id, req.session.userId);
  if (!resume) return res.status(404).json({ error: 'Resume not found' });
  db.prepare('UPDATE resumes SET is_active = 0 WHERE user_id = ?').run(req.session.userId);
  db.prepare('UPDATE resumes SET is_active = 1 WHERE id = ?').run(resume.id);
  res.json({ success: true });
});

// Delete a resume version. Jobs already scored against it keep their record
// (resume_id just stops resolving to a file). If the deleted one was active,
// the most recently uploaded remaining version becomes active.
app.delete('/api/resumes/:id', requireAuth, (req, res) => {
  const resume = getResumeRow(req.params.id, req.session.userId);
  if (!resume) return res.status(404).json({ error: 'Resume not found' });

  fs.rmSync(path.join(RESUMES_DIR, resume.filename), { force: true });
  db.prepare('DELETE FROM resumes WHERE id = ?').run(resume.id);

  if (resume.is_active) {
    const next = db.prepare('SELECT id FROM resumes WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT 1').get(req.session.userId);
    if (next) db.prepare('UPDATE resumes SET is_active = 1 WHERE id = ?').run(next.id);
  }

  res.json({ success: true });
});

app.get('/api/resume/status', requireAuth, (req, res) => {
  const resume = getResumeRow(null, req.session.userId);
  if (!resume) return res.json({ uploaded: false });
  const filePath = path.join(RESUMES_DIR, resume.filename);
  if (!fs.existsSync(filePath)) return res.json({ uploaded: false });
  const stat = fs.statSync(filePath);
  res.json({ uploaded: true, size: stat.size, modified: resume.uploaded_at, original_name: resume.original_name });
});

function deserializeJob(j) {
  return {
    ...j,
    missing_keywords: j.missing_keywords ? JSON.parse(j.missing_keywords) : [],
    ats_issues: j.ats_issues ? JSON.parse(j.ats_issues) : [],
    resume_tips: j.resume_tips ? JSON.parse(j.resume_tips) : [],
    top_recommendations: j.top_recommendations ? JSON.parse(j.top_recommendations) : [],
    // legacy fallback fields for old records
    strengths: j.strengths ? JSON.parse(j.strengths) : (j.highlights ? JSON.parse(j.highlights) : []),
    gaps: j.gaps ? JSON.parse(j.gaps) : (j.warnings ? JSON.parse(j.warnings) : []),
    sponsors: j.sponsors === null || j.sponsors === undefined ? null : Boolean(j.sponsors),
  };
}

// Serve a resume PDF — the active version by default, or a specific one by id
function serveResumePdf(req, res) {
  const resume = getResumeRow(req.params.id, req.session.userId);
  if (!resume) return res.status(404).json({ error: 'Resume not found' });
  const pdfPath = path.join(RESUMES_DIR, resume.filename);
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: 'Resume file not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${resume.original_name || 'resume.pdf'}"`);
  fs.createReadStream(pdfPath).pipe(res);
}
app.get('/api/resume-pdf', requireAuth, serveResumePdf);
app.get('/api/resume-pdf/:id', requireAuth, serveResumePdf);

// Serve a resume PDF with highlights drawn at specified phrases
app.post('/api/resume-pdf/highlighted', requireAuth, async (req, res) => {
  const { phrases, resumeId } = req.body; // string[], optional resume version id
  if (!Array.isArray(phrases)) return res.status(400).json({ error: 'phrases must be an array' });
  const resume = getResumeRow(resumeId, req.session.userId);
  if (!resume) return res.status(404).json({ error: 'Resume not found' });
  const pdfPath = path.join(RESUMES_DIR, resume.filename);
  try {
    const pdfBytes = await buildHighlightedPdf(pdfPath, phrases);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="resume-highlighted.pdf"');
    res.send(pdfBytes);
  } catch (e) {
    console.error('Highlight failed:', e.message);
    // Fall back to plain PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${resume.original_name || 'resume.pdf'}"`);
    fs.createReadStream(pdfPath).pipe(res);
  }
});

// Serve parsed resume text for the viewer — active version, or a specific one by id
async function serveResumeText(req, res) {
  const resume = getResumeRow(req.params.id, req.session.userId);
  if (!resume) return res.status(404).json({ error: 'Resume not found' });
  try {
    const text = await getResumeText(path.join(RESUMES_DIR, resume.filename));
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: 'Could not read resume PDF' });
  }
}
app.get('/api/resume-text', requireAuth, serveResumeText);
app.get('/api/resume-text/:id', requireAuth, serveResumeText);

// Redirects to the Google consent screen; opened via window.open, not axios
app.get('/api/gmail/connect', requireOwner, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('Gmail OAuth not configured — add GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET to server/.env');
  }
  res.redirect(getAuthUrl());
});

// OAuth redirect target — returns a small self-closing HTML page
app.get('/api/gmail/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send('<h3>Gmail connection cancelled.</h3><script>window.close()</script>');
  try {
    await handleOAuthCallback(code);
    res.send('<h3>Gmail connected! You can close this window.</h3><script>setTimeout(()=>window.close(),1200)</script>');
  } catch (e) {
    res.status(500).send(`<h3>Connection failed: ${e.message}</h3>`);
  }
});

app.get('/api/gmail/status', requireOwner, (req, res) => {
  const connected = isConnected();
  const { lastSyncAt, lastSyncSummary, needsReconnect } = getLastSync();
  const pendingSuggestions = db.prepare("SELECT COUNT(*) as n FROM gmail_suggestions WHERE status = 'pending'").get().n;
  res.json({
    connected,
    email: connected ? getConnectedEmail() : null,
    lastSyncAt,
    lastSyncSummary,
    pendingSuggestions,
    needsReconnect,
  });
});

app.post('/api/gmail/disconnect', requireOwner, async (req, res) => {
  await disconnect();
  res.json({ success: true });
});

app.post('/api/gmail/sync-now', requireOwner, async (req, res) => {
  try {
    const summary = await runSync({ trigger: 'manual' });
    if (summary.skipped) return res.status(409).json({ error: 'Sync already in progress' });
    res.json({ success: true, summary });
  } catch (e) {
    if (e.message === 'not_connected') return res.status(400).json({ error: 'Gmail not connected. Connect your Gmail account first.' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/gmail/suggestions', requireOwner, (req, res) => {
  const status = req.query.status || 'pending';
  const rows = db.prepare(`
    SELECT gs.*, j.company, j.role FROM gmail_suggestions gs
    JOIN jobs j ON j.id = gs.job_id
    WHERE gs.status = ?
    ORDER BY gs.created_at DESC
  `).all(status);
  res.json(rows);
});

app.post('/api/gmail/suggestions/:id/accept', requireOwner, (req, res) => {
  const suggestion = db.prepare('SELECT * FROM gmail_suggestions WHERE id = ?').get(req.params.id);
  if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
  if (suggestion.status !== 'pending') return res.status(400).json({ error: 'Suggestion already resolved' });

  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(suggestion.classification, suggestion.job_id);
  db.prepare("UPDATE gmail_suggestions SET status = 'applied' WHERE id = ?").run(suggestion.id);
  recordStatusChange(suggestion.job_id, suggestion.classification, 'gmail', suggestion.subject || suggestion.reason, suggestion.received_at);
  res.json({ success: true });
});

app.post('/api/gmail/suggestions/:id/dismiss', requireOwner, (req, res) => {
  const suggestion = db.prepare('SELECT * FROM gmail_suggestions WHERE id = ?').get(req.params.id);
  if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
  if (suggestion.status !== 'pending') return res.status(400).json({ error: 'Suggestion already resolved' });

  db.prepare("UPDATE gmail_suggestions SET status = 'dismissed' WHERE id = ?").run(suggestion.id);
  res.json({ success: true });
});

// Parse job details from a URL
app.post('/api/parse-job', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    const parsed = await parseJobUrl(url);
    res.json(parsed);
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

// Get all jobs for the signed-in user
app.get('/api/jobs', requireAuth, (req, res) => {
  const jobs = db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY applied_date DESC').all(req.session.userId);
  res.json(jobs.map(deserializeJob));
});

// Add a new job + score it
app.post('/api/jobs', requireAuth, async (req, res) => {
  const { company, role, jd, resume_id, applied_date } = req.body;

  if (!company || !role) {
    return res.status(400).json({ error: 'Company and role are required' });
  }

  let score = null, verdict = null, missing_keywords = [], ats_issues = [], resume_tips = [], top_recommendations = [], sponsors = null;
  const resume = jd ? getResumeRow(resume_id, req.session.userId) : null;

  if (jd && !resume) {
    console.error('Scoring skipped: no resume available (upload one, or pick a version)');
  } else if (jd) {
    console.log(`JD received, scoring against resume "${resume.original_name}" (id ${resume.id})...`);
    try {
      const pdfPath = path.join(RESUMES_DIR, resume.filename);
      const result = await scoreJob(jd, pdfPath);
      console.log('Score result:', result);
      score = result.score;
      verdict = result.verdict;
      missing_keywords = result.missing_keywords || [];
      ats_issues = result.ats_issues || [];
      resume_tips = result.bullet_critiques || result.resume_tips || [];
      top_recommendations = result.top_recommendations || [];
      sponsors = result.sponsors ?? null;
    } catch (e) {
      console.error('Scoring failed:', e.message);
      console.error(e.stack);
    }
  } else {
    console.log('No JD provided');
  }

  const stmt = db.prepare(`
    INSERT INTO jobs (company, role, jd, fit_score, fit_verdict, missing_keywords, ats_issues, resume_tips, top_recommendations, sponsors, resume_id, user_id${applied_date ? ', applied_date' : ''})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${applied_date ? ', ?' : ''})
  `);

  const params = [
    company, role, jd || null, score, verdict,
    JSON.stringify(missing_keywords),
    JSON.stringify(ats_issues),
    JSON.stringify(resume_tips),
    JSON.stringify(top_recommendations),
    sponsors === null ? null : (sponsors ? 1 : 0),
    resume ? resume.id : null,
    req.session.userId,
  ];
  if (applied_date) params.push(applied_date);

  const info = stmt.run(...params);

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(info.lastInsertRowid);
  recordStatusChange(job.id, job.status, 'system');
  res.json(deserializeJob(job));
});

// Fetches a job only if it belongs to the requesting user — every route
// below uses this instead of trusting req.params.id directly, so one
// account can never read/modify/delete another account's job by guessing ids.
function getOwnedJob(id, userId) {
  return db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, userId);
}

// Update job status
app.patch('/api/jobs/:id/status', requireAuth, (req, res) => {
  const job = getOwnedJob(req.params.id, req.session.userId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const { status } = req.body;
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, job.id);
  recordStatusChange(job.id, status, 'manual');
  res.json({ success: true });
});

// Status timeline for a job — manual changes, system creation, and Gmail-detected updates
app.get('/api/jobs/:id/history', requireAuth, (req, res) => {
  const job = getOwnedJob(req.params.id, req.session.userId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const history = db.prepare('SELECT * FROM job_status_history WHERE job_id = ? ORDER BY created_at ASC').all(job.id);
  res.json(history);
});

// Delete a job
app.delete('/api/jobs/:id', requireAuth, (req, res) => {
  const job = getOwnedJob(req.params.id, req.session.userId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
  res.json({ success: true });
});

// Stats
app.get('/api/stats', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const total = db.prepare('SELECT COUNT(*) as n FROM jobs WHERE user_id = ?').get(uid).n;
  const avgScore = db.prepare('SELECT AVG(fit_score) as avg FROM jobs WHERE user_id = ? AND fit_score IS NOT NULL').get(uid).avg;
  const strongMatches = db.prepare('SELECT COUNT(*) as n FROM jobs WHERE user_id = ? AND fit_score >= 80').get(uid).n;
  const noSponsorship = db.prepare('SELECT COUNT(*) as n FROM jobs WHERE user_id = ? AND sponsors = 0').get(uid).n;

  res.json({
    total,
    avgScore: avgScore ? Math.round(avgScore) : null,
    strongMatches,
    noSponsorship,
  });
});

// Serve the built React app in production (one service, no CORS needed there).
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // No path pattern (avoids Express 5 / path-to-regexp v6 wildcard syntax
  // pitfalls) — anything not matched by an API route above falls through here.
  app.use((req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

if (process.env.NODE_ENV !== 'test') {
  cron.schedule('0 8 * * *', () => {
    console.log('Running scheduled Gmail sync...');
    runSync({ trigger: 'cron' }).catch(e => console.error('Gmail cron sync failed:', e.message));
  });
  console.log('Gmail daily sync scheduled for 8:00 AM local time');

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

export default app;
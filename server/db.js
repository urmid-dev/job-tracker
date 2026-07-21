import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || 'jobs.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT DEFAULT 'applied',
    jd TEXT,
    fit_score INTEGER,
    fit_verdict TEXT,
    highlights TEXT,
    warnings TEXT,
    applied_date TEXT DEFAULT (date('now')),
    notes TEXT
  )
`);

// Migrate: add columns introduced after initial schema
try { db.exec('ALTER TABLE jobs ADD COLUMN strengths TEXT'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN gaps TEXT'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN missing_keywords TEXT'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN sponsors INTEGER'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN resume_tips TEXT'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN ats_issues TEXT'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN top_recommendations TEXT'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN resume_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN status_updated_at TEXT'); } catch {}
try { db.exec('ALTER TABLE jobs ADD COLUMN user_id INTEGER'); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_owner INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT,
    is_active INTEGER DEFAULT 0,
    uploaded_at TEXT DEFAULT (datetime('now'))
  )
`);

try { db.exec('ALTER TABLE resumes ADD COLUMN user_id INTEGER'); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS gmail_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    gmail_message_id TEXT UNIQUE NOT NULL,
    from_email TEXT,
    subject TEXT,
    snippet TEXT,
    received_at TEXT,
    classification TEXT,
    confidence TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Superseded by gmail_processed_job_messages below (dedup needs to be scoped
// per job, not global — see runSync in gmail.js) but left here so existing
// databases that already have this table don't break.
db.exec(`
  CREATE TABLE IF NOT EXISTS gmail_processed_messages (
    gmail_message_id TEXT PRIMARY KEY,
    processed_at TEXT DEFAULT (datetime('now'))
  )
`);

// Dedup keyed on (job, message) rather than just message: a message already
// checked against one job must still be checked against a job added later.
db.exec(`
  CREATE TABLE IF NOT EXISTS gmail_processed_job_messages (
    job_id INTEGER NOT NULL,
    gmail_message_id TEXT NOT NULL,
    processed_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (job_id, gmail_message_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS gmail_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS job_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

export default db;
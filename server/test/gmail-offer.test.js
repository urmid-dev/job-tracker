// Offer detection + query building live in their own file: each test file
// gets a fresh app (and rate limiter), and gmail-sync.test.js already uses
// most of the per-user sync-now budget.
import fs from 'fs';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import app from '../index.js';
import db from '../db.js';
import { loginOwnerAgent } from './helpers.js';

vi.mock('googleapis', () => {
  const mockGmailClient = {
    users: {
      getProfile: vi.fn(async () => ({ data: { emailAddress: 'test@example.com' } })),
      messages: {
        list: vi.fn(async () => ({ data: { messages: [] } })),
        get: vi.fn(async () => ({ data: { snippet: '', payload: { headers: [] } } })),
      },
    },
  };
  function MockOAuth2() {
    this.generateAuthUrl = vi.fn(() => 'https://mock-auth-url');
    this.getToken = vi.fn(async () => ({ tokens: { access_token: 'a', refresh_token: 'r' } }));
    this.setCredentials = vi.fn();
    this.on = vi.fn();
  }
  return {
    google: {
      auth: { OAuth2: MockOAuth2 },
      gmail: vi.fn(() => mockGmailClient),
    },
  };
});

vi.mock('groq-sdk', () => {
  const mockCreate = vi.fn();
  function MockGroq() {
    this.chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

const mockGmailClient = google.gmail();
const mockCreate = new Groq({}).chat.completions.create;

let agent;
beforeAll(async () => { agent = await loginOwnerAgent(app); });

function fakeGmailMessage({ from, subject, snippet, internalDate }) {
  return {
    data: {
      snippet,
      internalDate: String(internalDate),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: from },
          { name: 'Subject', value: subject },
        ],
        body: { data: Buffer.from(snippet, 'utf8').toString('base64url') },
      },
    },
  };
}

function classification(classification, confidence, reason = 'test reason') {
  return { choices: [{ message: { content: JSON.stringify({ classification, confidence, reason }) } }] };
}

beforeEach(() => {
  db.exec('DELETE FROM jobs; DELETE FROM job_status_history; DELETE FROM gmail_suggestions; DELETE FROM gmail_processed_job_messages; DELETE FROM gmail_meta;');
  vi.clearAllMocks();
  mockGmailClient.users.getProfile.mockResolvedValue({ data: { emailAddress: 'test@example.com' } });
  mockGmailClient.users.messages.list.mockResolvedValue({ data: { messages: [] } });
});

describe('offer detection and targeted Gmail search', () => {
  beforeAll(() => {
    fs.writeFileSync(process.env.GMAIL_TOKEN_PATH, JSON.stringify({ access_token: 'a', refresh_token: 'r' }));
  });

  it('moves a job to offer on a high-confidence offer email', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'BNY', role: 'Applied AI PM', applied_date: '2026-01-01' });
    const jobId = created.body.id;

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [{ id: 'offer1' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'BNY Talent <bny@myworkday.com>',
      subject: 'Your offer from BNY',
      snippet: 'Congratulations! We are delighted to extend you an offer.',
      internalDate: Date.parse('2026-02-01'),
    }));
    mockCreate.mockResolvedValueOnce(classification('offer', 'high', 'extend you an offer'));

    const sync = await agent.post('/api/gmail/sync-now');
    expect(sync.body.summary.appliedCount).toBe(1);

    const jobs = await agent.get('/api/jobs');
    expect(jobs.body.find(j => j.id === jobId).status).toBe('offer');
  });

  it('re-checks messages an older classifier dismissed as "other"', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'BNY', role: 'Applied AI PM', applied_date: '2026-01-01' });
    const jobId = created.body.id;
    // Simulate the old classifier having already seen the offer email and
    // filed it as "other" (processed, but no suggestion row).
    db.prepare('INSERT INTO gmail_processed_job_messages (job_id, gmail_message_id) VALUES (?, ?)').run(jobId, 'offer2');

    mockGmailClient.users.messages.list.mockResolvedValue({ data: { messages: [{ id: 'offer2' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'bny@myworkday.com',
      subject: 'Your offer from BNY',
      snippet: 'We are pleased to extend an offer.',
      internalDate: Date.parse('2026-02-01'),
    }));
    mockCreate.mockResolvedValue(classification('offer', 'high', 'pleased to extend an offer'));

    const first = await agent.post('/api/gmail/sync-now');
    expect(first.body.summary.matched).toBe(1);
    const jobs = await agent.get('/api/jobs');
    expect(jobs.body.find(j => j.id === jobId).status).toBe('offer');

    // Only once: the next sync doesn't re-check again.
    await agent.post('/api/jobs').send({ company: 'BNY', role: 'Another role', applied_date: '2026-01-01' });
    db.prepare("UPDATE jobs SET status = 'applied' WHERE id = ?").run(jobId);
    const second = await agent.post('/api/gmail/sync-now');
    expect(second.body.summary.matched).toBe(1); // only the newly added job sees it
  });

  it('asks Gmail only for messages mentioning tracked companies', async () => {
    await agent.post('/api/jobs').send({ company: 'Acme Corp', role: 'PM' });

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [] } });
    await agent.post('/api/gmail/sync-now');

    const query = mockGmailClient.users.messages.list.mock.calls[0][0].q;
    expect(query).toContain('"acme corp"');
    expect(query).toContain('"acme"');
  });
});

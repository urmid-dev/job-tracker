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

  it('skips job-alert emails without spending an AI call', async () => {
    await agent.post('/api/jobs').send({ company: 'BNY', role: 'PM', applied_date: '2026-01-01' });

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [{ id: 'alert1' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
      subject: '"product manager": BNY - Senior Associate and more',
      snippet: 'BNY is hiring. See 12 new jobs.',
      internalDate: Date.parse('2026-02-01'),
    }));

    const sync = await agent.post('/api/gmail/sync-now');
    expect(sync.body.summary.skippedBulk).toBe(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('caps AI checks per sync and leaves the rest for the next run', async () => {
    await agent.post('/api/jobs').send({ company: 'Capco', role: 'PM', applied_date: '2026-01-01' });
    const ids = Array.from({ length: 35 }, (_, i) => ({ id: `cap${i}` }));

    mockGmailClient.users.messages.list.mockResolvedValue({ data: { messages: ids } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'hr@capco.com', subject: 'Capco update', snippet: 'Thanks for applying to Capco', internalDate: Date.parse('2026-02-01'),
    }));
    mockCreate.mockResolvedValue(classification('other', 'high'));

    const first = await agent.post('/api/gmail/sync-now');
    expect(mockCreate).toHaveBeenCalledTimes(30);
    expect(first.body.summary.remaining).toBe(5);

    mockCreate.mockClear();
    const second = await agent.post('/api/gmail/sync-now');
    expect(mockCreate).toHaveBeenCalledTimes(5);
    expect(second.body.summary.remaining).toBe(0);
  });

  it('does not let an older email undo a newer status (offer then old interview invite)', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'BNY', role: 'PM', applied_date: '2026-01-01' });
    const jobId = created.body.id;
    const emails = {
      newOffer: { from: 'bny@myworkday.com', subject: 'Your offer from BNY', snippet: 'pleased to extend an offer', internalDate: Date.parse('2026-02-10') },
      oldInterview: { from: 'bny@myworkday.com', subject: 'BNY interview', snippet: 'schedule your interview', internalDate: Date.parse('2026-01-20') },
    };
    // Gmail lists newest first.
    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [{ id: 'newOffer' }, { id: 'oldInterview' }] } });
    mockGmailClient.users.messages.get.mockImplementation(async ({ id }) => fakeGmailMessage(emails[id]));
    mockCreate
      .mockResolvedValueOnce(classification('offer', 'high'))
      .mockResolvedValueOnce(classification('interview', 'high'));

    await agent.post('/api/gmail/sync-now');
    const jobs = await agent.get('/api/jobs');
    expect(jobs.body.find(j => j.id === jobId).status).toBe('offer');
    const superseded = db.prepare("SELECT classification FROM gmail_suggestions WHERE status = 'superseded'").all();
    expect(superseded).toEqual([{ classification: 'interview' }]);
  });

  it('stops on an AI rate limit and retries the unchecked emails next sync', async () => {
    await agent.post('/api/jobs').send({ company: 'Ratel', role: 'PM', applied_date: '2026-01-01' });

    mockGmailClient.users.messages.list.mockResolvedValue({ data: { messages: [{ id: 'r1' }, { id: 'r2' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'hr@ratel.com', subject: 'Ratel application', snippet: 'Ratel update', internalDate: Date.parse('2026-02-01'),
    }));
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('Rate limit reached'), { status: 429 }));

    const first = await agent.post('/api/gmail/sync-now');
    expect(first.body.summary.errors).toContain('rate_limited');
    expect(first.body.summary.remaining).toBe(2);

    mockCreate.mockResolvedValue(classification('other', 'high'));
    const second = await agent.post('/api/gmail/sync-now');
    expect(mockCreate).toHaveBeenCalledTimes(3); // 1 failed + 2 retried
    expect(second.body.summary.remaining).toBe(0);
  });

  it('reports no progress when idle', async () => {
    const res = await agent.get('/api/gmail/status');
    expect(res.body.syncProgress).toBeNull();
  });
});

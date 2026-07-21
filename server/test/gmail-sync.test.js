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

describe('when Gmail is not connected', () => {
  it('GET /api/gmail/status reports not connected', async () => {
    const res = await agent.get('/api/gmail/status');
    expect(res.body.connected).toBe(false);
  });

  it('POST /api/gmail/sync-now returns 400', async () => {
    const res = await agent.post('/api/gmail/sync-now');
    expect(res.status).toBe(400);
  });
});

describe('when Gmail is connected', () => {
  beforeAll(() => {
    fs.writeFileSync(process.env.GMAIL_TOKEN_PATH, JSON.stringify({ access_token: 'a', refresh_token: 'r' }));
  });

  it('GET /api/gmail/status reports connected', async () => {
    const res = await agent.get('/api/gmail/status');
    expect(res.body.connected).toBe(true);
  });

  it('auto-applies a high-confidence rejection and backdates the history entry to the email date', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Acme Corp', role: 'PM', applied_date: '2026-01-01' });
    const jobId = created.body.id;
    const emailDate = Date.parse('2026-01-15T12:00:00Z');

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [{ id: 'msg1' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'hr@acmecorp.com',
      subject: 'Update on your Acme Corp application',
      snippet: 'We regret to inform you that we will not be moving forward with your application.',
      internalDate: emailDate,
    }));
    mockCreate.mockResolvedValueOnce(classification('rejected', 'high', 'Explicit rejection language'));

    const sync = await agent.post('/api/gmail/sync-now');
    expect(sync.status).toBe(200);
    expect(sync.body.summary.matched).toBe(1);
    expect(sync.body.summary.appliedCount).toBe(1);

    const jobs = await agent.get('/api/jobs');
    expect(jobs.body.find(j => j.id === jobId).status).toBe('rejected');

    const history = await agent.get(`/api/jobs/${jobId}/history`);
    const gmailEntry = history.body.find(h => h.source === 'gmail');
    expect(gmailEntry).toBeTruthy();
    expect(gmailEntry.status).toBe('rejected');
    expect(new Date(gmailEntry.created_at).getTime()).toBe(emailDate);
  });

  it('leaves a low-confidence match as a pending suggestion without changing job status', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Beta Inc', role: 'Eng', applied_date: '2026-01-01' });
    const jobId = created.body.id;

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [{ id: 'msg2' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'careers@betainc.com',
      subject: 'Thanks for applying to Beta Inc',
      snippet: 'We have received your application and will be in touch.',
      internalDate: Date.parse('2026-01-20'),
    }));
    mockCreate.mockResolvedValueOnce(classification('rejected', 'low', 'Vague, not explicit'));

    const sync = await agent.post('/api/gmail/sync-now');
    expect(sync.body.summary.pendingCount).toBe(1);
    expect(sync.body.summary.appliedCount).toBe(0);

    const jobs = await agent.get('/api/jobs');
    expect(jobs.body.find(j => j.id === jobId).status).toBe('applied');

    const suggestions = await agent.get('/api/gmail/suggestions');
    expect(suggestions.body).toHaveLength(1);
    expect(suggestions.body[0].job_id).toBe(jobId);
  });

  it('accept applies the suggested status and dismiss leaves it untouched', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Gamma LLC', role: 'Eng', applied_date: '2026-01-01' });
    const jobId = created.body.id;

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [{ id: 'msg3' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'hr@gammallc.com',
      subject: 'Gamma LLC application',
      snippet: 'we would like to schedule a call with you',
      internalDate: Date.parse('2026-01-20'),
    }));
    mockCreate.mockResolvedValueOnce(classification('interview', 'low', 'Suggestive but not explicit'));

    await agent.post('/api/gmail/sync-now');
    const pending = await agent.get('/api/gmail/suggestions');
    const suggestionId = pending.body[0].id;

    const accept = await agent.post(`/api/gmail/suggestions/${suggestionId}/accept`);
    expect(accept.status).toBe(200);

    const jobs = await agent.get('/api/jobs');
    expect(jobs.body.find(j => j.id === jobId).status).toBe('interview');

    const resolved = await agent.get('/api/gmail/suggestions?status=applied');
    expect(resolved.body).toHaveLength(1);
  });

  it('dismiss leaves the job status untouched', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Delta Co', role: 'Eng', applied_date: '2026-01-01' });
    const jobId = created.body.id;

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [{ id: 'msg4' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'hr@deltaco.com',
      subject: 'Delta Co application',
      snippet: 'thanks, we will be in touch',
      internalDate: Date.parse('2026-01-20'),
    }));
    mockCreate.mockResolvedValueOnce(classification('rejected', 'low', 'ambiguous'));

    await agent.post('/api/gmail/sync-now');
    const pending = await agent.get('/api/gmail/suggestions');
    const suggestionId = pending.body[0].id;

    const dismiss = await agent.post(`/api/gmail/suggestions/${suggestionId}/dismiss`);
    expect(dismiss.status).toBe(200);

    const jobs = await agent.get('/api/jobs');
    expect(jobs.body.find(j => j.id === jobId).status).toBe('applied');
  });

  it('does not re-classify the same message twice for the same job (dedup)', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Epsilon', role: 'Eng', applied_date: '2026-01-01' });

    mockGmailClient.users.messages.list.mockResolvedValue({ data: { messages: [{ id: 'msg5' }] } });
    mockGmailClient.users.messages.get.mockResolvedValue(fakeGmailMessage({
      from: 'hr@epsilon.com',
      subject: 'Epsilon application',
      snippet: 'we regret to inform you, not selected',
      internalDate: Date.parse('2026-01-20'),
    }));
    mockCreate.mockResolvedValue(classification('rejected', 'high', 'explicit'));

    const first = await agent.post('/api/gmail/sync-now');
    expect(first.body.summary.matched).toBe(1);

    const second = await agent.post('/api/gmail/sync-now');
    expect(second.body.summary.matched).toBe(0);

    const suggestions = await agent.get('/api/gmail/suggestions?status=applied');
    expect(suggestions.body).toHaveLength(1);
    void created;
  });

  it('widens the scan window for a job applied to long ago (backfill)', async () => {
    await agent.post('/api/jobs').send({ company: 'Zeta', role: 'Eng', applied_date: '2025-12-01' });

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [] } });
    await agent.post('/api/gmail/sync-now');

    const query = mockGmailClient.users.messages.list.mock.calls[0][0].q;
    const days = Number(query.match(/newer_than:(\d+)d/)[1]);
    expect(days).toBeGreaterThan(2);
  });

  it('uses only a 2-day window when all tracked jobs are recent', async () => {
    await agent.post('/api/jobs').send({ company: 'Eta', role: 'Eng' }); // defaults to today

    mockGmailClient.users.messages.list.mockResolvedValueOnce({ data: { messages: [] } });
    await agent.post('/api/gmail/sync-now');

    const query = mockGmailClient.users.messages.list.mock.calls[0][0].q;
    expect(query).toBe('newer_than:2d');
  });
});

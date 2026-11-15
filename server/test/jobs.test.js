import app from '../index.js';
import db from '../db.js';
import { loginAgent } from './helpers.js';

let agent;
beforeAll(async () => { agent = await loginAgent(app); });

beforeEach(() => {
  db.exec('DELETE FROM jobs; DELETE FROM job_status_history;');
});

describe('POST /api/jobs', () => {
  it('creates a job without a jd, no scoring attempted', async () => {
    const res = await agent.post('/api/jobs').send({ company: 'Acme', role: 'PM' });
    expect(res.status).toBe(200);
    expect(res.body.company).toBe('Acme');
    expect(res.body.status).toBe('applied');
    expect(res.body.fit_score).toBeNull();
    expect(res.body.jd).toBeNull();
  });

  it('creates a job with a jd but skips scoring cleanly when no resume exists', async () => {
    const res = await agent.post('/api/jobs').send({ company: 'Acme', role: 'PM', jd: 'some job description' });
    expect(res.status).toBe(200);
    expect(res.body.fit_score).toBeNull();
    expect(res.body.jd).toBe('some job description');
    expect(res.body.scoring_error).toMatch(/no resume/i);
  });

  it('rejects a request missing company or role', async () => {
    const res = await agent.post('/api/jobs').send({ company: 'Acme' });
    expect(res.status).toBe(400);
  });

  it('records a system history entry on creation', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Acme', role: 'PM' });
    const history = await agent.get(`/api/jobs/${created.body.id}/history`);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].source).toBe('system');
    expect(history.body[0].status).toBe('applied');
  });

  it('respects a custom applied_date instead of defaulting to today', async () => {
    const res = await agent.post('/api/jobs').send({ company: 'Acme', role: 'PM', applied_date: '2026-01-01' });
    expect(res.body.applied_date).toBe('2026-01-01');
  });
});

describe('GET /api/jobs', () => {
  it('returns all created jobs ordered by applied_date descending', async () => {
    await agent.post('/api/jobs').send({ company: 'A', role: 'R1', applied_date: '2026-01-01' });
    await agent.post('/api/jobs').send({ company: 'B', role: 'R2', applied_date: '2026-02-01' });
    const res = await agent.get('/api/jobs');
    expect(res.body).toHaveLength(2);
    expect(res.body[0].company).toBe('B');
    expect(res.body[1].company).toBe('A');
  });
});

describe('PATCH /api/jobs/:id/status', () => {
  it('updates status, bumps status_updated_at, and logs a manual history entry', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Acme', role: 'PM' });
    const id = created.body.id;

    const patchRes = await agent.patch(`/api/jobs/${id}/status`).send({ status: 'interview' });
    expect(patchRes.status).toBe(200);

    const jobs = await agent.get('/api/jobs');
    const job = jobs.body.find(j => j.id === id);
    expect(job.status).toBe('interview');
    expect(job.status_updated_at).toBeTruthy();

    const history = await agent.get(`/api/jobs/${id}/history`);
    expect(history.body).toHaveLength(2);
    expect(history.body[1].source).toBe('manual');
    expect(history.body[1].status).toBe('interview');
  });
});

describe('DELETE /api/jobs/:id', () => {
  it('removes the job', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Acme', role: 'PM' });
    const id = created.body.id;

    const delRes = await agent.delete(`/api/jobs/${id}`);
    expect(delRes.status).toBe(200);

    const jobs = await agent.get('/api/jobs');
    expect(jobs.body.find(j => j.id === id)).toBeUndefined();
  });
});

describe('GET /api/jobs/:id/history', () => {
  it('returns entries ordered oldest first', async () => {
    const created = await agent.post('/api/jobs').send({ company: 'Acme', role: 'PM' });
    const id = created.body.id;
    await agent.patch(`/api/jobs/${id}/status`).send({ status: 'interview' });
    await agent.patch(`/api/jobs/${id}/status`).send({ status: 'rejected' });

    const history = await agent.get(`/api/jobs/${id}/history`);
    expect(history.body.map(h => h.status)).toEqual(['applied', 'interview', 'rejected']);
  });
});

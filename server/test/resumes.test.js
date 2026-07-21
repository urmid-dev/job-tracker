import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from '../index.js';
import db from '../db.js';
import { loginAgent } from './helpers.js';

let agent;
beforeAll(async () => { agent = await loginAgent(app); });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESUMES_DIR = path.join(__dirname, '..', 'resumes');
const FIXTURE = path.join(__dirname, 'fixtures', 'sample.pdf');

afterEach(() => {
  // Resume uploads land in the real resumes/ dir (shared with the running app),
  // so clean up any files this test file created.
  const rows = db.prepare('SELECT filename FROM resumes').all();
  for (const r of rows) {
    try { fs.rmSync(path.join(RESUMES_DIR, r.filename)); } catch {}
  }
  db.exec('DELETE FROM resumes; DELETE FROM jobs;');
});

describe('POST /api/resume', () => {
  it('uploads a resume and marks it active', async () => {
    const res = await agent.post('/api/resume').attach('resume', FIXTURE);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.filename).toBe('sample.pdf');

    const list = await agent.get('/api/resumes');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].is_active).toBe(true);
  });

  it('rejects a request with no file', async () => {
    const res = await agent.post('/api/resume');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/resumes', () => {
  it('lists multiple uploaded versions without overwriting', async () => {
    await agent.post('/api/resume').attach('resume', FIXTURE);
    await agent.post('/api/resume').attach('resume', FIXTURE);
    const list = await agent.get('/api/resumes');
    expect(list.body).toHaveLength(2);
    // most recently uploaded should be active
    expect(list.body.filter(r => r.is_active)).toHaveLength(1);
  });
});

describe('POST /api/resumes/:id/activate', () => {
  it('switches the active resume', async () => {
    const first = await agent.post('/api/resume').attach('resume', FIXTURE);
    await agent.post('/api/resume').attach('resume', FIXTURE);

    const activate = await agent.post(`/api/resumes/${first.body.id}/activate`);
    expect(activate.status).toBe(200);

    const list = await agent.get('/api/resumes');
    const active = list.body.find(r => r.is_active);
    expect(active.id).toBe(first.body.id);
  });

  it('404s for an unknown id', async () => {
    const res = await agent.post('/api/resumes/999999/activate');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/resumes/:id', () => {
  it('removes a non-active resume without changing the active one', async () => {
    const first = await agent.post('/api/resume').attach('resume', FIXTURE);
    const second = await agent.post('/api/resume').attach('resume', FIXTURE);

    const del = await agent.delete(`/api/resumes/${first.body.id}`);
    expect(del.status).toBe(200);

    const list = await agent.get('/api/resumes');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(second.body.id);
    expect(list.body[0].is_active).toBe(true);
  });

  it('promotes the next most recent resume when the active one is deleted', async () => {
    const first = await agent.post('/api/resume').attach('resume', FIXTURE);
    const second = await agent.post('/api/resume').attach('resume', FIXTURE);
    // second is active (most recently uploaded)

    const del = await agent.delete(`/api/resumes/${second.body.id}`);
    expect(del.status).toBe(200);

    const list = await agent.get('/api/resumes');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(first.body.id);
    expect(list.body[0].is_active).toBe(true);
  });
});

describe('GET /api/resume/status', () => {
  it('reports not uploaded when no resume exists', async () => {
    const res = await agent.get('/api/resume/status');
    expect(res.body.uploaded).toBe(false);
  });

  it('reports the active resume once one is uploaded', async () => {
    await agent.post('/api/resume').attach('resume', FIXTURE);
    const res = await agent.get('/api/resume/status');
    expect(res.body.uploaded).toBe(true);
    expect(res.body.original_name).toBe('sample.pdf');
  });
});

import request from 'supertest';
import app from '../index.js';
import { loginAgent, loginOwnerAgent } from './helpers.js';

describe('auth', () => {
  it('GET /api/auth/status reports unauthenticated with no session', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.body.authenticated).toBe(false);
  });

  it('POST /api/auth/signup requires a valid email and an 8+ char password', async () => {
    const noEmail = await request(app).post('/api/auth/signup').send({ email: 'not-an-email', password: 'longenough' });
    expect(noEmail.status).toBe(400);

    const shortPassword = await request(app).post('/api/auth/signup').send({ email: 'a@example.com', password: 'short' });
    expect(shortPassword.status).toBe(400);
  });

  it('POST /api/auth/signup rejects a duplicate email', async () => {
    const email = `dup-${Date.now()}@example.com`;
    const first = await request(app).post('/api/auth/signup').send({ email, password: 'test-password-123' });
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/signup').send({ email, password: 'another-password' });
    expect(second.status).toBe(409);
  });

  it('POST /api/auth/signup logs the new account in and starts a session', async () => {
    const agent = await loginAgent(app);
    const status = await agent.get('/api/auth/status');
    expect(status.body.authenticated).toBe(true);
  });

  it('POST /api/auth/login rejects a wrong password and an unknown email', async () => {
    const email = `wrongpw-${Date.now()}@example.com`;
    await request(app).post('/api/auth/signup').send({ email, password: 'test-password-123' });

    const wrongPassword = await request(app).post('/api/auth/login').send({ email, password: 'nope-nope-nope' });
    expect(wrongPassword.status).toBe(401);

    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever1' });
    expect(unknownEmail.status).toBe(401);
  });

  it('POST /api/auth/logout ends the session', async () => {
    const agent = await loginAgent(app);
    await agent.post('/api/auth/logout');
    const status = await agent.get('/api/auth/status');
    expect(status.body.authenticated).toBe(false);
  });

  it('gates every job/resume/gmail route behind auth', async () => {
    const noAuth = request(app);
    expect((await noAuth.get('/api/jobs')).status).toBe(401);
    expect((await noAuth.get('/api/stats')).status).toBe(401);
    expect((await noAuth.get('/api/resumes')).status).toBe(401);
    expect((await noAuth.post('/api/jobs').send({ company: 'A', role: 'B' })).status).toBe(401);
    expect((await noAuth.get('/api/gmail/status')).status).toBe(401);
  });

  it('only the OWNER_EMAIL account can reach Gmail routes — everyone else gets 403', async () => {
    const owner = await loginOwnerAgent(app);
    expect((await owner.get('/api/gmail/status')).status).toBe(200);

    const nonOwner = await loginAgent(app);
    expect((await nonOwner.get('/api/gmail/status')).status).toBe(403);
  });

  it('keeps each account jobs isolated from every other account', async () => {
    const alice = await loginAgent(app);
    const bob = await loginAgent(app);

    const created = await alice.post('/api/jobs').send({ company: 'Isolated Co', role: 'Engineer' });
    expect(created.status).toBe(200);
    const jobId = created.body.id;

    const bobsJobs = await bob.get('/api/jobs');
    expect(bobsJobs.body.find(j => j.id === jobId)).toBeUndefined();

    expect((await bob.get(`/api/jobs/${jobId}/history`)).status).toBe(404);
    expect((await bob.patch(`/api/jobs/${jobId}/status`).send({ status: 'rejected' })).status).toBe(404);
    expect((await bob.delete(`/api/jobs/${jobId}`)).status).toBe(404);

    // Alice's job is untouched and still reachable by Alice.
    const alicesJobs = await alice.get('/api/jobs');
    expect(alicesJobs.body.find(j => j.id === jobId)).toBeDefined();
  });
});

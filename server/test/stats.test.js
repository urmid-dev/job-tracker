import request from 'supertest';
import app from '../index.js';
import db from '../db.js';
import { loginAgent } from './helpers.js';

let agent;
let userId;
beforeAll(async () => {
  agent = await loginAgent(app);
  const status = await agent.get('/api/auth/status');
  userId = db.prepare('SELECT id FROM users WHERE email = ?').get(status.body.email).id;
});

beforeEach(() => {
  db.exec('DELETE FROM jobs;');
});

function seedJob({ company, fit_score = null, sponsors = null }) {
  db.prepare(`
    INSERT INTO jobs (company, role, fit_score, sponsors, user_id) VALUES (?, 'Eng', ?, ?, ?)
  `).run(company, fit_score, sponsors === null ? null : (sponsors ? 1 : 0), userId);
}

describe('GET /api/stats', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(401);
  });

  it('returns zeroed stats with no jobs', async () => {
    const res = await agent.get('/api/stats');
    expect(res.body).toEqual({ total: 0, avgScore: null, strongMatches: 0, noSponsorship: 0 });
  });

  it('counts total jobs regardless of score', async () => {
    seedJob({ company: 'A' });
    seedJob({ company: 'B', fit_score: 90 });
    const res = await agent.get('/api/stats');
    expect(res.body.total).toBe(2);
  });

  it('averages only jobs that have a fit_score', async () => {
    seedJob({ company: 'A', fit_score: 80 });
    seedJob({ company: 'B', fit_score: 60 });
    seedJob({ company: 'C' }); // no score, should be excluded from the average
    const res = await agent.get('/api/stats');
    expect(res.body.avgScore).toBe(70);
  });

  it('counts strong matches as fit_score >= 80', async () => {
    seedJob({ company: 'A', fit_score: 85 });
    seedJob({ company: 'B', fit_score: 79 });
    seedJob({ company: 'C', fit_score: 80 });
    const res = await agent.get('/api/stats');
    expect(res.body.strongMatches).toBe(2);
  });

  it('counts jobs explicitly flagged as no sponsorship', async () => {
    seedJob({ company: 'A', sponsors: false });
    seedJob({ company: 'B', sponsors: true });
    seedJob({ company: 'C' }); // sponsors unknown, should not count
    const res = await agent.get('/api/stats');
    expect(res.body.noSponsorship).toBe(1);
  });
});

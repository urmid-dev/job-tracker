import { normalizeCompanyName, matchesCompany, computeScanDays, extractEmailBody, buildSyncQueries } from '../gmail.js';

describe('normalizeCompanyName', () => {
  it('lowercases and strips common suffixes', () => {
    expect(normalizeCompanyName('Acme Corp, Inc.')).toBe('acme');
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(normalizeCompanyName('  Stripe,  Inc.  ')).toBe('stripe');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeCompanyName('')).toBe('');
    expect(normalizeCompanyName(null)).toBe('');
  });
});

describe('matchesCompany', () => {
  it('matches when the company name appears in the subject/snippet', () => {
    expect(matchesCompany(
      'Acme Corp',
      'jobs@acme.com',
      'Update on your Acme application',
      'Thanks for applying to Acme Corp'
    )).toBe(true);
  });

  it('matches via the sender domain even with no company name in the body', () => {
    expect(matchesCompany(
      'Stripe',
      'recruiting@stripe.com',
      'Your application status',
      'no company name mentioned here'
    )).toBe(true);
  });

  it('does not match unrelated email', () => {
    expect(matchesCompany(
      'Zzyzx Robotics',
      'noreply@linkedin.com',
      'Weekly digest',
      'jobs you might like'
    )).toBe(false);
  });

  it('returns false for a job with an empty company name', () => {
    expect(matchesCompany('', 'a@b.com', 'subject', 'snippet')).toBe(false);
  });
});

describe('computeScanDays', () => {
  it('floors at the 2-day minimum when jobs were applied recently', () => {
    const jobs = [{ applied_date: new Date().toISOString().slice(0, 10) }];
    expect(computeScanDays(jobs)).toBe(2);
  });

  it('widens to match an old applied_date', () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const jobs = [{ applied_date: fortyDaysAgo }];
    const days = computeScanDays(jobs);
    expect(days).toBeGreaterThanOrEqual(40);
    expect(days).toBeLessThanOrEqual(41); // allow for rounding at the day boundary
  });

  it('caps at 60 days for a very old job', () => {
    const yearAgo = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    const jobs = [{ applied_date: yearAgo }];
    expect(computeScanDays(jobs)).toBe(60);
  });

  it('ignores jobs with missing/invalid applied_date', () => {
    const jobs = [{ applied_date: null }, { applied_date: 'not-a-date' }];
    expect(computeScanDays(jobs)).toBe(2);
  });

  it('uses the oldest job among several', () => {
    const recent = new Date().toISOString().slice(0, 10);
    const old = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const jobs = [{ applied_date: recent }, { applied_date: old }];
    expect(computeScanDays(jobs)).toBeGreaterThanOrEqual(10);
  });
});

describe('extractEmailBody', () => {
  function b64url(text) {
    return Buffer.from(text, 'utf8').toString('base64url');
  }

  it('extracts a plain-text part directly on the payload', () => {
    const payload = { mimeType: 'text/plain', body: { data: b64url('Hello world') } };
    expect(extractEmailBody(payload)).toBe('Hello world');
  });

  it('walks multipart messages to find the plain-text part', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64url('<p>HTML version</p>') } },
        { mimeType: 'text/plain', body: { data: b64url('Plain text version') } },
      ],
    };
    expect(extractEmailBody(payload)).toBe('Plain text version');
  });

  it('falls back to stripped HTML when no plain-text part exists', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64url('<div>Hello <b>there</b></div>') } },
      ],
    };
    expect(extractEmailBody(payload)).toBe('Hello there');
  });

  it('returns empty string when there is no body data anywhere', () => {
    expect(extractEmailBody({ mimeType: 'multipart/mixed', parts: [] })).toBe('');
  });

  it('truncates very long bodies', () => {
    const longText = 'a'.repeat(10000);
    const payload = { mimeType: 'text/plain', body: { data: b64url(longText) } };
    expect(extractEmailBody(payload).length).toBeLessThanOrEqual(4000);
  });
});

describe('buildSyncQueries', () => {
  it('searches each company by raw and normalized name', () => {
    expect(buildSyncQueries([{ company: 'Acme Corp' }, { company: 'BNY' }], 7))
      .toEqual(['newer_than:7d ("acme corp" OR "acme" OR "bny")']);
  });

  it('strips characters that would break Gmail search syntax', () => {
    const [q] = buildSyncQueries([{ company: 'Foo "Bar" (Baz)' }], 3);
    expect(q).toBe('newer_than:3d ("foo bar baz")');
  });

  it('splits many companies across several queries', () => {
    const jobs = Array.from({ length: 20 }, (_, i) => ({ company: `Company${i}` }));
    const queries = buildSyncQueries(jobs, 2);
    expect(queries.length).toBe(2);
    expect(queries.join(' ')).toContain('"company19"');
  });

  it('returns no queries when no job has a company', () => {
    expect(buildSyncQueries([{ company: '' }], 2)).toEqual([]);
  });
});

import { vi } from 'vitest';
import { parseJobUrl, linkedInJobId, greenhouseJob } from '../scraper.js';

const LI_GUEST_HTML = `
  <h2 class="top-card-layout__title font-sans topcard__title">Product Manager, Growth &amp; Monetization</h2>
  <a class="topcard__org-name-link" data-tracking-control-name="public_jobs_topcard-org-name" href="#">
    Stripe
  </a>
  <div class="show-more-less-html__markup relative"><p>Own the roadmap.</p><ul><li>SQL</li></ul></div>`;

function htmlResponse(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('linkedInJobId', () => {
  it.each([
    ['https://www.linkedin.com/jobs/view/4467278136', '4467278136'],
    ['https://www.linkedin.com/jobs/view/4467278136/?trk=public_jobs_topcard', '4467278136'],
    ['https://www.linkedin.com/jobs/view/product-manager-at-stripe-4467278136', '4467278136'],
    ['https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4467278136', '4467278136'],
    ['https://www.linkedin.com/jobs/search/?currentJobId=4467278136&keywords=pm', '4467278136'],
    ['https://linkedin.com/jobs/view/4467278136', '4467278136'],
  ])('%s -> %s', (url, id) => expect(linkedInJobId(url)).toBe(id));

  it('returns null for non-LinkedIn or id-less URLs', () => {
    expect(linkedInJobId('https://jobs.lever.co/x/123')).toBeNull();
    expect(linkedInJobId('https://www.linkedin.com/jobs/search/?keywords=pm')).toBeNull();
    expect(linkedInJobId('not a url')).toBeNull();
  });
});

describe('greenhouseJob', () => {
  it('recognizes Greenhouse board URLs', () => {
    expect(greenhouseJob('https://job-boards.greenhouse.io/airbnb/jobs/8365363')).toEqual({ board: 'airbnb', id: '8365363' });
    expect(greenhouseJob('https://boards.greenhouse.io/airbnb/jobs/8365363?gh_src=x')).toEqual({ board: 'airbnb', id: '8365363' });
    expect(greenhouseJob('https://boards.greenhouse.io/embed/job_app?for=airbnb&token=8365363')).toEqual({ board: 'airbnb', id: '8365363' });
    expect(greenhouseJob('https://careers.airbnb.com/positions/8365363')).toBeNull();
  });
});

describe('parseJobUrl', () => {
  it('turns a logged-in LinkedIn feed URL into a guest-endpoint fetch', async () => {
    const fetchMock = vi.fn(async () => htmlResponse(LI_GUEST_HTML));
    vi.stubGlobal('fetch', fetchMock);

    const r = await parseJobUrl('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4467278136');
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4467278136');
    expect(r.company).toBe('Stripe');
    expect(r.role).toBe('Product Manager, Growth & Monetization');
    expect(r.jd).toContain('Own the roadmap.');
    expect(r.jd).toContain('• SQL');
  });

  it('reports a bot-check page as an error instead of returning it as the job', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('<title>Just a moment...</title>', 403)));
    await expect(parseJobUrl('https://example.com/careers/123')).rejects.toThrow(/blocked|login/i);
  });

  it('rejects a LinkedIn search page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      htmlResponse('<title>Product Manager Jobs in United States (11,000+ Open Roles)</title>')));
    await expect(parseJobUrl('https://www.linkedin.com/jobs/search/?keywords=pm')).rejects.toThrow(/search page/i);
  });

  it('uses the Greenhouse API for Greenhouse boards', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u) => {
      if (u.includes('/jobs/')) {
        return Response.json({ title: 'Account Executive', company_name: 'Airbnb', content: '&lt;p&gt;Sell things &amp;amp; more&lt;/p&gt;' });
      }
      return Response.json({ name: 'Airbnb' });
    }));
    const r = await parseJobUrl('https://job-boards.greenhouse.io/airbnb/jobs/8365363');
    expect(r).toEqual({ company: 'Airbnb', role: 'Account Executive', jd: 'Sell things & more' });
  });

  it('still parses JSON-LD job postings on other sites', async () => {
    const ld = { '@type': 'JobPosting', title: 'Engineer', hiringOrganization: { name: 'Acme' }, description: '<p>Build</p>' };
    vi.stubGlobal('fetch', vi.fn(async () =>
      htmlResponse(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)));
    expect(await parseJobUrl('https://jobs.example.com/1')).toEqual({ company: 'Acme', role: 'Engineer', jd: 'Build' });
  });
});

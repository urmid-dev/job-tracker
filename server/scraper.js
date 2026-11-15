const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(html) {
  // Some sources (Greenhouse API) entity-encode the HTML itself, so decode first.
  const raw = /&lt;\w/.test(html) ? decodeEntities(html) : html;
  return decodeEntities(
    raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const clean = (s) => (s ? decodeEntities(s).replace(/\s+/g, ' ').trim() : '');

// LinkedIn job links come in many shapes; the logged-in ones
// (/jobs/collections/...?currentJobId=, /jobs/search/?currentJobId=) return a
// login/bot-check page to a server, not the posting. Pull out the job id and
// use LinkedIn's public guest endpoint, which serves the posting without login.
export function linkedInJobId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const fromParam = u.searchParams.get('currentJobId');
  if (fromParam && /^\d+$/.test(fromParam)) return fromParam;
  const fromPath = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/);
  return fromPath ? fromPath[1] : null;
}

// job-boards.greenhouse.io/<board>/jobs/<id> and boards.greenhouse.io/<board>/jobs/<id>
export function greenhouseJob(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)greenhouse\.io$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:embed\/job_app\/)?([^/]+)\/jobs\/(\d+)/);
  if (m) return { board: m[1], id: m[2] };
  const board = u.searchParams.get('for');
  const id = u.searchParams.get('token') || u.searchParams.get('gh_jid');
  return board && id ? { board, id } : null;
}

function parseLinkedIn(html) {
  const role = html.match(/<h[12][^>]+class="[^"]*top-card-layout__title[^"]*"[^>]*>([^<]+)<\/h[12]>/)?.[1];
  const company = html.match(/<a[^>]+data-tracking-control-name="public_jobs_topcard-org-name"[^>]*>[\s]*([^<]+)/)?.[1];
  const descBlock = html.match(/<div class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const jd = descBlock ? stripHtml(descBlock[1]) : '';
  if (role && company) return { company: clean(company), role: clean(role), jd };
  return null;
}

function parseJsonLd(html) {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      const posting = items.find(d => d['@type'] === 'JobPosting');
      if (posting) {
        return {
          company: clean(posting.hiringOrganization?.name || ''),
          role: clean(posting.title || ''),
          jd: posting.description ? stripHtml(posting.description) : '',
        };
      }
    } catch {}
  }
  return null;
}

// Parses "Company hiring Role in Location | LinkedIn" og:title format
function parseLinkedInOgTitle(title) {
  const t = title.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  const hiringMatch = t.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+.+$/i);
  if (hiringMatch) return { company: hiringMatch[1].trim(), role: hiringMatch[2].trim() };
  const dashMatch = t.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (dashMatch) return { role: dashMatch[1].trim(), company: dashMatch[2].trim() };
  return { company: '', role: t };
}

// Pages that mean "you got blocked / need to log in", not a job posting.
const BLOCK_TITLES = /^(just a moment|attention required|access denied|sign ?up|sign ?in|log ?in|security verification|linkedin login)/i;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const html = await res.text();
  return { res, html };
}

const BLOCKED_MSG = 'This site blocked the request or needs a login, so the job details could not be read. Fill them in manually below.';

export async function parseJobUrl(url) {
  // Greenhouse: use the public job-board API (full description + company name).
  const gh = greenhouseJob(url);
  if (gh) {
    try {
      const [jobRes, boardRes] = await Promise.all([
        fetch(`https://boards-api.greenhouse.io/v1/boards/${gh.board}/jobs/${gh.id}?content=true`),
        fetch(`https://boards-api.greenhouse.io/v1/boards/${gh.board}`),
      ]);
      if (jobRes.ok) {
        const job = await jobRes.json();
        const board = boardRes.ok ? await boardRes.json() : {};
        return {
          company: clean(job.company_name || board.name || ''),
          role: clean(job.title || ''),
          jd: job.content ? stripHtml(job.content) : '',
        };
      }
    } catch {}
    // fall through to generic HTML scraping
  }

  const liId = linkedInJobId(url);
  if (liId) {
    const { res, html } = await fetchHtml(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${liId}`);
    if (res.ok) {
      const li = parseLinkedIn(html);
      if (li) return li;
    }
    // Guest endpoint failed; try the canonical public page before giving up.
    url = `https://www.linkedin.com/jobs/view/${liId}`;
  }

  const { res, html } = await fetchHtml(url);
  const isLinkedIn = /linkedin\.com/i.test(url);

  if (isLinkedIn) {
    const li = parseLinkedIn(html);
    if (li) return li;
  }

  // Generic: JSON-LD structured data (works on many job boards)
  const ld = parseJsonLd(html);
  if (ld && ld.role) return ld;

  const ogTitleTag = html.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogDescTag = html.match(/property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  const ogSiteTag = html.match(/property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  const rawTitle = clean(ogTitleTag?.[1] || pageTitle?.[1] || '');

  if (!res.ok || !rawTitle || BLOCK_TITLES.test(rawTitle)) {
    throw new Error(res.ok && !rawTitle
      ? 'Could not extract job details from this URL. Make sure it is a public job posting.'
      : BLOCKED_MSG);
  }

  // A LinkedIn search/listing page rather than a single posting
  if (isLinkedIn && /\bjobs in\b|open roles|\bjobs\s*\|/i.test(rawTitle)) {
    throw new Error('That looks like a LinkedIn search page, not a single job. Open the job and copy its link (it should contain /jobs/view/ or currentJobId=).');
  }

  const { company, role } = isLinkedIn
    ? parseLinkedInOgTitle(rawTitle)
    : {
        company: clean(ogSiteTag?.[1] || '').replace(/^careers?\s+(at|@)\s+/i, '').replace(/\s+(careers?|jobs)$/i, ''),
        role: rawTitle.replace(/\s*[|\-–]\s*.+$/, '').trim(),
      };
  return { company, role, jd: clean(ogDescTag?.[1] || '') };
}

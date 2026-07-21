function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseLinkedIn(html) {
  const role = html.match(/<h1[^>]+class="[^"]*top-card-layout__title[^"]*"[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
  const company = html.match(/<a[^>]+data-tracking-control-name="public_jobs_topcard-org-name"[^>]*>[\s]*([^<]+)/)?.[1]?.trim();
  const descBlock = html.match(/<div class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const jd = descBlock ? stripHtml(descBlock[1]) : '';
  if (role && company) return { company, role, jd };
  return null;
}

function parseJsonLd(html) {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      const posting = items.find(d => d['@type'] === 'JobPosting');
      if (posting) {
        return {
          company: posting.hiringOrganization?.name || '',
          role: posting.title || '',
          jd: posting.description ? stripHtml(posting.description) : '',
        };
      }
    } catch {}
  }
  return null;
}

// Parses "Company hiring Role in Location | LinkedIn" og:title format
function parseLinkedInOgTitle(title) {
  const clean = title.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
  const hiringMatch = clean.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+.+$/i);
  if (hiringMatch) return { company: hiringMatch[1].trim(), role: hiringMatch[2].trim() };
  const dashMatch = clean.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (dashMatch) return { role: dashMatch[1].trim(), company: dashMatch[2].trim() };
  return { company: '', role: clean };
}

export async function parseJobUrl(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  const html = await res.text();
  const isLinkedIn = url.includes('linkedin.com');

  // LinkedIn: try HTML selectors first (most reliable), then JSON-LD, then og:title
  if (isLinkedIn) {
    const li = parseLinkedIn(html);
    if (li) return li;
  }

  // Generic: JSON-LD structured data (works on many job boards)
  const ld = parseJsonLd(html);
  if (ld) return ld;

  // LinkedIn og:title fallback — has company + role but short description
  const ogTitleTag = html.match(/property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogDescTag = html.match(/property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  const pageTitle = html.match(/<title>([^<]+)<\/title>/i);

  const rawTitle = ogTitleTag?.[1] || pageTitle?.[1] || '';
  if (rawTitle) {
    const { company, role } = isLinkedIn
      ? parseLinkedInOgTitle(rawTitle)
      : { company: '', role: rawTitle.replace(/\s*[|\-–]\s*.+$/, '').trim() };
    return { company, role, jd: ogDescTag?.[1] || '' };
  }

  throw new Error('Could not extract job details from this URL. Make sure it is a public job posting.');
}

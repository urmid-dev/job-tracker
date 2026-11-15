// Real-API evals for the two LLM call sites (server/groq.js's scoreJob,
// server/gmail.js's classifyEmail). Calls the actual Groq API — costs a
// small amount of real usage each run. Not part of `npm test`; run manually
// with `npm run eval` (requires a real GROQ_API_KEY in server/.env).
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreJob } from '../groq.js';
import { classifyEmail } from '../gmail.js';
import { scoreResultSchema } from '../schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESUME_PATH = path.join(__dirname, 'fixtures', 'eval-resume.pdf');

if (!process.env.GROQ_API_KEY) {
  console.error('GROQ_API_KEY is not set — evals need a real key to call the actual model.');
  process.exit(1);
}

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.log(`✗ ${name} — ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('Running resume-scoring evals against', RESUME_PATH, '\n');

  const strongJd = `
    Software Engineer — Backend
    We're looking for a software engineer with strong Python experience to
    build and maintain REST APIs at scale. You'll write SQL queries against
    our data warehouse, collaborate cross-functionally with product and
    design, and work in an Agile/Scrum environment. Experience leading small
    engineering teams and migrating legacy systems is a big plus.
  `;

  await check('strong-match JD scores >= 70 and has valid schema', async () => {
    const result = await scoreJob(strongJd, RESUME_PATH);
    scoreResultSchema.parse(result);
    assert(result.score >= 70, `expected score >= 70, got ${result.score}`);
  });

  await check('strong-match JD: every bullet critique has word_count_match === true', async () => {
    const result = await scoreJob(strongJd, RESUME_PATH);
    for (const tip of result.bullet_critiques) {
      assert(tip.word_count_match === true, `bullet "${tip.original_text}" did not end up word-count matched`);
    }
  });

  const weakJd = `
    Registered Nurse — ICU
    Seeking a licensed Registered Nurse with critical care experience to
    join our Intensive Care Unit. Must be comfortable with ventilator
    management, IV medication administration, and coordinating with
    attending physicians on patient care plans. BLS/ACLS certification
    required.
  `;

  await check('weak-match JD scores < 50', async () => {
    const result = await scoreJob(weakJd, RESUME_PATH);
    scoreResultSchema.parse(result);
    assert(result.score < 50, `expected score < 50, got ${result.score}`);
  });

  await check('minimal JD does not crash and returns a valid schema', async () => {
    const result = await scoreJob('Looking for a great teammate.', RESUME_PATH);
    scoreResultSchema.parse(result);
  });

  console.log('\nRunning Gmail-classification evals\n');

  const job = { company: 'Acme Corp', role: 'Software Engineer' };

  await check('explicit rejection email classifies as rejected/high', async () => {
    const result = await classifyEmail(job, {
      from: 'hr@acmecorp.com',
      subject: 'Update on your application',
      body: 'Thank you for your interest in Acme Corp. After careful consideration, we regret to inform you that we will not be moving forward with your application at this time.',
    });
    assert(result.classification === 'rejected', `expected 'rejected', got '${result.classification}'`);
    assert(result.confidence === 'high', `expected 'high' confidence, got '${result.confidence}'`);
  });

  await check('explicit interview invite classifies as interview/high', async () => {
    const result = await classifyEmail(job, {
      from: 'recruiting@acmecorp.com',
      subject: 'Next steps for your application',
      body: "We were impressed with your background and would like to schedule a call for the next round of interviews. Please let us know your availability this week.",
    });
    assert(result.classification === 'interview', `expected 'interview', got '${result.classification}'`);
    assert(result.confidence === 'high', `expected 'high' confidence, got '${result.confidence}'`);
  });

  await check('explicit offer (that also mentions a call) classifies as offer/high', async () => {
    const result = await classifyEmail(job, {
      from: 'recruiting@acmecorp.com',
      subject: 'Your offer from Acme Corp',
      body: "Congratulations! We are pleased to extend you an offer for the position. Your recruiter will set up a quick call to walk through the offer letter and start date.",
    });
    assert(result.classification === 'offer', `expected 'offer', got '${result.classification}'`);
    assert(result.confidence === 'high', `expected 'high' confidence, got '${result.confidence}'`);
  });

  await check('generic acknowledgment email does not get misread as a decision', async () => {
    // Confidence only matters for rejected/interview (it gates auto-apply);
    // for a plain "received your application" acknowledgment, the important
    // guarantee is that it's not misclassified as rejected/interview at all —
    // 'other' is correct here regardless of confidence.
    const result = await classifyEmail(job, {
      from: 'noreply@acmecorp.com',
      subject: 'Thanks for applying',
      body: 'Thank you for applying to Acme Corp. We have received your application and will be in touch.',
    });
    assert(result.classification === 'other', `expected 'other', got '${result.classification}'`);
  });

  await check('unrelated newsletter classifies as other', async () => {
    const result = await classifyEmail(job, {
      from: 'newsletter@somejobsite.com',
      subject: 'This week’s top job picks for you',
      body: 'Check out these 10 exciting new job openings that match your profile! Click here to browse.',
    });
    assert(result.classification === 'other', `expected 'other', got '${result.classification}'`);
  });

  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${results.length} eval cases passed.`);
  if (passed !== results.length) process.exit(1);
}

main();

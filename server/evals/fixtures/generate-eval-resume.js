// One-off generator for evals/fixtures/eval-resume.pdf — a small but
// realistic resume with real bullets, so scoring evals have something
// meaningful to critique (the test/fixtures/sample.pdf used elsewhere is
// just a placeholder file for upload-flow tests, not real content).
// Re-run with `node evals/fixtures/generate-eval-resume.js` if the content
// below is ever changed.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LINES = [
  'Alex Candidate',
  'Software Engineer',
  '',
  'WORK EXPERIENCE',
  '',
  'Software Engineer, Acme Corp (2022-2024)',
  '- Built and shipped a Python microservice handling 10,000 requests per day, reducing latency by 30%',
  '- Led a team of 3 engineers to migrate a legacy monolith to a REST API architecture',
  '- Wrote SQL queries to analyze user behavior and presented findings to stakeholders',
  '- Collaborated with cross-functional teams including product and design to launch 5 new features',
  '',
  'Software Engineer Intern, Beta Inc (2021-2022)',
  '- Developed a React dashboard used by 200 internal employees daily',
  '- Automated a manual data pipeline using Python scripts, saving 10 hours per week',
  '- Participated in code reviews and improved test coverage from 60% to 85%',
  '',
  'SKILLS',
  'Python, JavaScript, React, SQL, REST APIs, Git, Agile/Scrum',
];

async function main() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  let y = 750;

  for (const line of LINES) {
    page.drawText(line, { x: 50, y, size: fontSize, font, color: rgb(0, 0, 0) });
    y -= fontSize + 6;
  }

  const bytes = await doc.save();
  const outPath = path.join(__dirname, 'eval-resume.pdf');
  fs.writeFileSync(outPath, bytes);
  console.log('Wrote', outPath);
}

main();

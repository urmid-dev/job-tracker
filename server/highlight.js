import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const COLORS = [
  rgb(1,    0.85, 0   ),  // amber
  rgb(0.4,  0.7,  1   ),  // blue
  rgb(0.8,  0.5,  1   ),  // purple
  rgb(0.3,  0.9,  0.5 ),  // green
  rgb(1,    0.45, 0.65),  // pink
];

async function findPhraseRects(pdfjsPage, phrase) {
  const content = await pdfjsPage.getTextContent();
  const items = content.items.filter(it => it.str && it.str.length > 0);

  // Build a flat character array tracking which item each char belongs to
  let fullText = '';
  const charMap = []; // index → item

  for (const item of items) {
    for (const ch of item.str) {
      charMap.push(item);
      fullText += ch;
    }
    // space between items so words don't fuse
    charMap.push(null);
    fullText += ' ';
  }

  const needle = phrase.replace(/\s+/g, ' ').trim();
  const idx = fullText.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return [];

  // Collect distinct items that fall inside the match range
  const involved = new Set();
  for (let i = idx; i < idx + needle.length; i++) {
    if (charMap[i]) involved.add(charMap[i]);
  }

  // Group items by rounded Y (= same line)
  const byLine = {};
  for (const item of involved) {
    const lineKey = Math.round(item.transform[5]);
    if (!byLine[lineKey]) byLine[lineKey] = [];
    byLine[lineKey].push(item);
  }

  // Build one rect per line
  return Object.values(byLine).map(lineItems => {
    lineItems.sort((a, b) => a.transform[4] - b.transform[4]);
    const first = lineItems[0];
    const last  = lineItems[lineItems.length - 1];
    const h = first.height || 12;
    return {
      x:      first.transform[4] - 2,
      y:      first.transform[5] - h * 0.3,   // descender + bottom padding
      width:  (last.transform[4] + (last.width || 0)) - first.transform[4] + 4,
      height: h * 1.5,                         // full cap height + ascender room
    };
  });
}

export async function buildHighlightedPdf(pdfPath, phrases) {
  const pdfBytes = fs.readFileSync(pdfPath);

  const [pdfjsDoc, pdfDoc] = await Promise.all([
    pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise,
    PDFDocument.load(pdfBytes),
  ]);

  const pdfPages = pdfDoc.getPages();

  for (let p = 1; p <= pdfjsDoc.numPages; p++) {
    const pdfjsPage = await pdfjsDoc.getPage(p);
    const pdfPage  = pdfPages[p - 1];

    for (let i = 0; i < phrases.length; i++) {
      if (!phrases[i]) continue;
      const rects = await findPhraseRects(pdfjsPage, phrases[i]);
      const color = COLORS[i % COLORS.length];
      for (const r of rects) {
        pdfPage.drawRectangle({ ...r, color, opacity: 0.75 });
      }
    }
  }

  return Buffer.from(await pdfDoc.save());
}

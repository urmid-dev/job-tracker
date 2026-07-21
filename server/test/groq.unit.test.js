import { countWords, forceWordCount } from '../groq.js';

describe('countWords', () => {
  it('counts simple space-separated words', () => {
    expect(countWords('Led a team of five engineers')).toBe(6);
  });

  it('treats hyphenated words as a single word', () => {
    expect(countWords('Shipped a RAG-powered conversational agent')).toBe(5);
  });

  it('treats dollar amounts and percentages as single words', () => {
    expect(countWords('Delivered $4B in value, a 40% lift')).toBe(7);
  });

  it('handles empty/undefined input', () => {
    expect(countWords('')).toBe(0);
    expect(countWords(undefined)).toBe(0);
  });

  it('collapses extra whitespace', () => {
    expect(countWords('  too    many   spaces  ')).toBe(3);
  });
});

describe('forceWordCount', () => {
  it('leaves a bullet unchanged if it already matches the target', () => {
    const bullet = 'Led a team of five engineers';
    expect(countWords(forceWordCount(bullet, countWords(bullet)))).toBe(countWords(bullet));
  });

  it('trims words down to an exact shorter target', () => {
    const bullet = 'Led a small team of five engineers across two continents';
    const result = forceWordCount(bullet, 6);
    expect(countWords(result)).toBe(6);
  });

  it('pads words up to an exact longer target', () => {
    const bullet = 'Led the team';
    const result = forceWordCount(bullet, 6);
    expect(countWords(result)).toBe(6);
  });

  it('never produces an empty string when trimming aggressively', () => {
    const bullet = 'Led a team of five';
    const result = forceWordCount(bullet, 1);
    expect(result.trim().length).toBeGreaterThan(0);
  });
});

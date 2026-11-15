import { z } from 'zod';

// Mirrors the exact JSON contract requested in groq.js's scoreJob prompt.
// Validated before enforceWordCounts() adds its own computed fields
// (original_word_count/rewritten_word_count/word_count_match).
export const scoreResultSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(['Strong match', 'Good match', 'Partial match', 'Weak match']),
  missing_keywords: z.array(z.string()),
  ats_issues: z.array(z.string()),
  bullet_critiques: z.array(z.object({
    section: z.string(),
    original_text: z.string(),
    original_full_bullet: z.string(),
    rewritten: z.string(),
    keywords_added: z.array(z.string()),
    reason: z.string(),
  })),
  top_recommendations: z.array(z.string()),
  sponsors: z.boolean().nullable(),
});

// Mirrors the exact JSON contract requested in gmail.js's classifyEmail prompt.
export const classificationResultSchema = z.object({
  // Values double as job statuses: a high-confidence result is written
  // straight into jobs.status.
  classification: z.enum(['rejected', 'interview', 'offer', 'other']),
  confidence: z.enum(['high', 'low']),
  reason: z.string(),
});

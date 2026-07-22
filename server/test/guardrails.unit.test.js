import { scoreResultSchema, classificationResultSchema } from '../schemas.js';

const validScoreResult = {
  score: 82,
  verdict: 'Good match',
  missing_keywords: ['A/B testing', 'SQL'],
  ats_issues: ['No clear summary section'],
  bullet_critiques: [
    {
      section: 'Work Experience – Acme',
      original_text: 'Led a team of engineers',
      original_full_bullet: 'Led a team of engineers to ship a new feature',
      rewritten: 'Led cross-functional collaboration to ship a new feature',
      keywords_added: ['cross-functional collaboration'],
      reason: 'Mirrors JD language for team leadership.',
    },
  ],
  top_recommendations: ['Add a summary section'],
  sponsors: true,
};

describe('scoreResultSchema', () => {
  it('accepts a well-formed scoring result', () => {
    expect(() => scoreResultSchema.parse(validScoreResult)).not.toThrow();
  });

  it('accepts a null sponsors value', () => {
    expect(() => scoreResultSchema.parse({ ...validScoreResult, sponsors: null })).not.toThrow();
  });

  it('rejects an out-of-range score', () => {
    expect(() => scoreResultSchema.parse({ ...validScoreResult, score: 150 })).toThrow();
  });

  it('rejects a negative score', () => {
    expect(() => scoreResultSchema.parse({ ...validScoreResult, score: -5 })).toThrow();
  });

  it('rejects a verdict outside the exact allowed strings', () => {
    expect(() => scoreResultSchema.parse({ ...validScoreResult, verdict: 'Excellent match' })).toThrow();
  });

  it('rejects missing_keywords that is not an array', () => {
    expect(() => scoreResultSchema.parse({ ...validScoreResult, missing_keywords: 'SQL, Python' })).toThrow();
  });

  it('rejects a bullet_critiques entry missing a required key', () => {
    const bad = {
      ...validScoreResult,
      bullet_critiques: [{ section: 'Work Experience', original_text: 'x', rewritten: 'y', keywords_added: [], reason: 'z' }],
    };
    expect(() => scoreResultSchema.parse(bad)).toThrow();
  });

  it('rejects a bullet_critiques entry with keywords_added as a string instead of an array', () => {
    const bad = {
      ...validScoreResult,
      bullet_critiques: [{ ...validScoreResult.bullet_critiques[0], keywords_added: 'SQL' }],
    };
    expect(() => scoreResultSchema.parse(bad)).toThrow();
  });
});

const validClassification = {
  classification: 'rejected',
  confidence: 'high',
  reason: 'Explicit rejection language.',
};

describe('classificationResultSchema', () => {
  it('accepts a well-formed classification result', () => {
    expect(() => classificationResultSchema.parse(validClassification)).not.toThrow();
  });

  it('accepts every valid classification/confidence combination', () => {
    for (const classification of ['rejected', 'interview', 'other']) {
      for (const confidence of ['high', 'low']) {
        expect(() => classificationResultSchema.parse({ classification, confidence, reason: 'x' })).not.toThrow();
      }
    }
  });

  it('rejects a classification with wrong casing (model drift)', () => {
    expect(() => classificationResultSchema.parse({ ...validClassification, classification: 'Rejected' })).toThrow();
  });

  it('rejects a classification value outside the known set', () => {
    expect(() => classificationResultSchema.parse({ ...validClassification, classification: 'not_selected' })).toThrow();
  });

  it('rejects a confidence value outside high/low', () => {
    expect(() => classificationResultSchema.parse({ ...validClassification, confidence: 'very high' })).toThrow();
  });

  it('rejects a missing reason field', () => {
    const { reason, ...withoutReason } = validClassification;
    expect(() => classificationResultSchema.parse(withoutReason)).toThrow();
  });
});

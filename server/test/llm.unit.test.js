import { describeLlmError, GROQ_MODEL, REASONING_OPTS } from '../llm.js';

describe('llm config', () => {
  it('no longer uses the retired llama-3.3-70b-versatile model by default', () => {
    expect(GROQ_MODEL).not.toBe('llama-3.3-70b-versatile');
  });

  it('sets low reasoning effort for gpt-oss models', () => {
    if (GROQ_MODEL.startsWith('openai/gpt-oss')) expect(REASONING_OPTS).toEqual({ reasoning_effort: 'low' });
  });
});

describe('describeLlmError', () => {
  it('explains a retired / missing model', () => {
    expect(describeLlmError({ status: 404 })).toMatch(/no longer available/);
  });
  it('explains a bad API key', () => {
    expect(describeLlmError({ status: 401 })).toMatch(/API key/);
  });
  it('explains rate limiting', () => {
    expect(describeLlmError({ status: 429 })).toMatch(/rate-limited/);
  });
  it('falls back to a generic message', () => {
    expect(describeLlmError(new Error('boom'))).toMatch(/AI scoring failed/);
  });
});

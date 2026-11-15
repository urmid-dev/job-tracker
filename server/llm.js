import Groq from 'groq-sdk';

// Single place for the Groq model + client. Groq retires models without much
// notice (llama-3.3-70b-versatile went away and silently broke scoring and
// Gmail classification), so the model is overridable via GROQ_MODEL and only
// named here.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// gpt-oss is a reasoning model: its hidden reasoning tokens count against
// max_tokens, so callers need generous limits, and low effort keeps latency
// and cost down for these structured-extraction tasks.
export const REASONING_OPTS = GROQ_MODEL.startsWith('openai/gpt-oss')
  ? { reasoning_effort: 'low' }
  : {};

// Constructed lazily (on first actual use, not at import time) so a missing
// GROQ_API_KEY only breaks LLM calls, not the entire server process.
let _groq;
export function groq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// Turns a Groq/SDK error into a short message that's safe to show the user.
export function describeLlmError(e) {
  if (e?.status === 404 || e?.error?.error?.code === 'model_not_found') {
    return `The AI model "${GROQ_MODEL}" is no longer available from Groq. Set GROQ_MODEL to a current model.`;
  }
  if (e?.status === 401) return 'The Groq API key is missing or invalid.';
  if (e?.status === 429) return 'The AI service is rate-limited right now. Try again in a minute.';
  return 'AI scoring failed. Try again, or check the server logs.';
}

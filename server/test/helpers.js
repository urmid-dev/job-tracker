import request from 'supertest';

let counter = 0;
const TEST_PASSWORD = 'test-password-123';

// A supertest agent for a signed-up user — persists the session cookie
// across requests, so gated routes work like a real logged-in user. Signs
// up a brand new account by default (unique email, full isolation from
// other agents); pass an explicit email to reuse/create that specific
// account instead (falls back to logging in if it already exists in this
// test file's isolated database).
export async function loginAgent(app, email) {
  const agent = request.agent(app);
  const targetEmail = email || `test-user-${process.pid}-${Date.now()}-${counter++}@example.com`;

  const signup = await agent.post('/api/auth/signup').send({ email: targetEmail, password: TEST_PASSWORD });
  if (signup.status === 200) return agent;

  if (signup.status === 409) {
    const login = await agent.post('/api/auth/login').send({ email: targetEmail, password: TEST_PASSWORD });
    if (login.status === 200) return agent;
    throw new Error(`loginAgent login fallback failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  throw new Error(`loginAgent signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
}

// The account matching OWNER_EMAIL — becomes (or already is) the owner, the
// only account allowed to reach Gmail routes. Safe to call more than once
// per test file.
export async function loginOwnerAgent(app) {
  return loginAgent(app, process.env.OWNER_EMAIL);
}

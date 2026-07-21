import { useState } from 'react';
import api from '../api';

export default function LoginModal({ onLoggedIn }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.post(`/auth/${mode}`, { email, password });
      onLoggedIn();
    } catch (e) {
      setError(e.response?.data?.error || `${mode === 'signup' ? 'Sign up' : 'Sign in'} failed. Please try again.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white border border-gray-200 rounded-2xl w-full max-w-sm p-6 shadow-2xl shadow-gray-900/10"
      >
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">JT</span>
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-gray-900">JobTrack AI</span>
        </div>

        <h2 className="text-sm font-medium text-gray-900 mb-4">
          {mode === 'signup' ? 'Create your account' : 'Sign in'}
        </h2>

        <label className="text-xs text-gray-500 block mb-1">Email</label>
        <input
          type="email"
          autoFocus
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500 text-gray-900 mb-3"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <label className="text-xs text-gray-500 block mb-1">Password</label>
        <input
          type="password"
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500 text-gray-900"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {mode === 'signup' && (
          <p className="text-[10px] text-gray-400 mt-1">At least 8 characters.</p>
        )}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <button
          type="submit"
          disabled={loading || !email || !password}
          className="w-full mt-4 text-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 rounded-lg py-2 font-medium shadow-sm shadow-teal-900/10 transition-colors"
        >
          {loading ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); }}
          className="w-full mt-3 text-xs text-gray-500 hover:text-gray-700"
        >
          {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
        </button>
      </form>
    </div>
  );
}

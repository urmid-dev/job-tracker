import { useState, useEffect } from 'react';
import api from '../api';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function AddJobModal({ onClose, onAdd }) {
  const [step, setStep] = useState('url');
  const [url, setUrl] = useState('');
  const [parsed, setParsed] = useState({ company: '', role: '', jd: '' });
  const [appliedDate, setAppliedDate] = useState(today());
  const [parsing, setParsing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [resumes, setResumes] = useState([]);
  const [resumeId, setResumeId] = useState(null);

  useEffect(() => {
    api.get('/resumes').then(r => {
      setResumes(r.data);
      const active = r.data.find(res => res.is_active);
      setResumeId(active ? active.id : (r.data[0]?.id ?? null));
    }).catch(() => {});
  }, []);

  async function handleParse() {
    if (!url.trim()) return;
    setParsing(true);
    setError('');
    try {
      const res = await api.post('/parse-job', { url: url.trim() });
      setParsed(res.data);
      setStep('review');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to parse this URL. You can fill in the details manually below.');
      setParsed({ company: '', role: '', jd: '' });
      setStep('review');
    } finally {
      setParsing(false);
    }
  }

  async function handleAdd() {
    if (!parsed.company || !parsed.role) return;
    setAdding(true);
    await onAdd({ ...parsed, resume_id: resumeId, applied_date: appliedDate });
    setAdding(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-[2px] flex items-center justify-center z-50">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-lg p-6 shadow-2xl shadow-gray-900/10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-medium text-gray-900">
            {step === 'url' ? 'Add job from LinkedIn' : 'Review & add'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {step === 'url' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">LinkedIn job URL</label>
              <input
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500 text-gray-900"
                placeholder="https://www.linkedin.com/jobs/view/..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleParse()}
                autoFocus
              />
              <p className="text-xs text-gray-400 mt-1.5">Paste the URL from a LinkedIn job listing — we'll extract the details automatically.</p>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 text-sm text-gray-600 border border-gray-300 rounded-lg py-2 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleParse}
                disabled={!url.trim() || parsing}
                className="flex-1 text-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 rounded-lg py-2 font-medium shadow-sm shadow-teal-900/10 transition-colors"
              >
                {parsing ? 'Parsing...' : 'Parse job'}
              </button>
            </div>
            <button
              onClick={() => { setParsed({ company: '', role: '', jd: '' }); setError(''); setStep('review'); }}
              className="w-full text-xs text-gray-500 hover:text-gray-700 py-1"
            >
              Or enter details manually →
            </button>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3">
            {error && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-700">{error} Fill in the fields below manually.</p>
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 block mb-1">Company</label>
              <input
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500 text-gray-900"
                placeholder="e.g. Stripe"
                value={parsed.company}
                onChange={e => setParsed(p => ({ ...p, company: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Role</label>
              <input
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500 text-gray-900"
                placeholder="e.g. Product Manager, Payments"
                value={parsed.role}
                onChange={e => setParsed(p => ({ ...p, role: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Date applied</label>
              <input
                type="date"
                max={today()}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500 text-gray-900"
                value={appliedDate}
                onChange={e => setAppliedDate(e.target.value)}
              />
              <p className="text-[10px] text-gray-400 mt-1">
                If you applied a while ago, set the real date — Gmail sync uses it to look back far enough for old rejection/interview emails.
              </p>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Job description <span className="text-gray-400">{parsed.jd ? '(parsed)' : '(optional)'}</span>
              </label>
              <textarea
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500 text-gray-900 h-36 resize-none"
                placeholder="Paste the job description for AI fit scoring — or leave blank to just track this job..."
                value={parsed.jd}
                onChange={e => setParsed(p => ({ ...p, jd: e.target.value }))}
              />
            </div>
            {parsed.jd.trim() && (
              resumes.length > 0 ? (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Match against resume</label>
                  <select
                    className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500 text-gray-900"
                    value={resumeId ?? ''}
                    onChange={e => setResumeId(Number(e.target.value))}
                  >
                    {resumes.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.original_name}{r.is_active ? ' (active)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-amber-600">No resume uploaded yet — upload one first for AI fit scoring.</p>
              )
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('url'); setError(''); }}
                className="flex-1 text-sm text-gray-600 border border-gray-300 rounded-lg py-2 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={handleAdd}
                disabled={adding || !parsed.company || !parsed.role}
                className="flex-1 text-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 rounded-lg py-2 font-medium shadow-sm shadow-teal-900/10 transition-colors"
              >
                {adding ? (parsed.jd.trim() ? 'Scoring with AI...' : 'Adding...') : (parsed.jd.trim() ? 'Add & score' : 'Add job')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import api from '../api';
import ResumeViewer from './ResumeViewer';

const fitColor = (score) => {
  if (!score) return 'text-gray-400';
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-red-600';
};

const STATUSES = [
  { key: 'applied', label: 'Applied', color: 'bg-blue-500' },
  { key: 'interview', label: 'Interview', color: 'bg-amber-500' },
  { key: 'rejected', label: 'Rejected', color: 'bg-red-500' },
  { key: 'offer', label: 'Offer', color: 'bg-emerald-500' },
];

function statusMeta(status) {
  return STATUSES.find(s => s.key === status) || STATUSES[0];
}

function formatDateTime(dateStr) {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(dateStr);
  const iso = dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr;
  return new Date(hasTz ? iso : iso + 'Z').toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function Timeline({ jobId, status }) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.get(`/jobs/${jobId}/history`).then(r => setHistory(r.data)).catch(() => {});
  }, [jobId, status]);

  if (history.length === 0) return null;

  return (
    <Section label="Status Timeline">
      <div className="space-y-2">
        {history.map(h => {
          const meta = statusMeta(h.status);
          return (
            <div key={h.id} className="flex gap-2.5 text-xs">
              <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${meta.color}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-gray-700 font-medium">{meta.label}</span>
                  {h.source === 'gmail' && (
                    <span className="text-[9px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-0.5">
                      via Gmail
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">{formatDateTime(h.created_at)}</span>
                </div>
                {h.detail && <div className="text-[10px] text-gray-500 mt-0.5 truncate">{h.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SponsorBadge({ sponsors }) {
  if (sponsors === true) return (
    <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
      <span className="text-emerald-600 text-sm">✓</span>
      <span className="text-xs text-emerald-700 font-medium">Visa sponsorship available</span>
    </div>
  );
  if (sponsors === false) return (
    <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      <span className="text-red-600 text-sm">✕</span>
      <span className="text-xs text-red-700 font-medium">No visa sponsorship</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
      <span className="text-gray-500 text-sm">?</span>
      <span className="text-xs text-gray-500">Sponsorship not mentioned</span>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">{label}</div>
      {children}
    </div>
  );
}

export default function CoachPanel({ job, onClose, onDelete, onStatusChange }) {
  const [showResume, setShowResume] = useState(false);

  const tips = (job.resume_tips || []);
  const tipsAreObjects = tips.length > 0 && typeof tips[0] === 'object';
  const hasScore = Boolean(job.fit_score);
  const currentStatus = statusMeta(job.status);

  return (
    <>
      <div className="w-80 border-l border-gray-200 bg-white flex flex-col flex-shrink-0 shadow-[-4px_0_16px_-8px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-200">
          <div className="text-xs font-medium text-gray-900">ATS + Recruiter Review</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Job header */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5">
            <div className="text-xs text-gray-500">{job.company}</div>
            <div className="text-sm font-medium mt-0.5 text-gray-900">{job.role}</div>
            <div className="text-xs text-gray-400 mt-1">Applied {job.applied_date}</div>
          </div>

          {/* Status control */}
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${currentStatus.color}`} />
            <select
              value={job.status}
              onChange={e => onStatusChange?.(job.id, e.target.value)}
              className="flex-1 bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-teal-500 text-gray-900"
            >
              {STATUSES.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            {job.status_updated_at && (
              <span className="text-[10px] text-gray-400 shrink-0" title="Date of current status">
                since {formatDateTime(job.status_updated_at).replace(/,.*/, '')}
              </span>
            )}
          </div>

          <Timeline jobId={job.id} status={job.status} />

          {hasScore ? (
            <>
              {/* Score */}
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-bold ${fitColor(job.fit_score)}`}>{job.fit_score}%</div>
                <div>
                  <div className="text-xs text-gray-500">ATS match score</div>
                  <div className="text-sm font-medium text-gray-900">{job.fit_verdict}</div>
                </div>
              </div>

              <SponsorBadge sponsors={job.sponsors} />

              {/* 1. Missing Keywords */}
              {job.missing_keywords?.length > 0 && (
                <Section label="① Missing Keywords & Skills">
                  <div className="flex flex-wrap gap-1.5">
                    {job.missing_keywords.map((kw, i) => (
                      <span key={i} className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-md px-2 py-0.5">
                        {kw}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {/* 2. ATS Issues */}
              {job.ats_issues?.length > 0 && (
                <Section label="② ATS Compatibility Issues">
                  <div className="space-y-2">
                    {job.ats_issues.map((issue, i) => (
                      <div key={i} className="flex gap-2 text-xs text-gray-700 bg-orange-50 border border-orange-200 rounded-lg p-2.5">
                        <span className="text-orange-500 mt-0.5 shrink-0">!</span>
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* 3. Bullet Critiques */}
              {tips.length > 0 && (
                <Section label="③ Bullet Point Critique">
                  <div className="space-y-2 mb-2">
                    {tips.map((tip, i) => (
                      <div key={i} className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                        <div className="text-[10px] text-gray-400 mb-1">{tipsAreObjects ? tip.section : 'Resume'}</div>
                        {tipsAreObjects ? (
                          <>
                            <div className="line-through text-gray-400 mb-1">"{tip.original_text}"</div>
                            <div className="text-gray-800">→ {tip.rewritten || tip.suggested_text}</div>
                            {(tip.keywords_added?.length > 0 || tip.rewritten_word_count != null) && (
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                {tip.keywords_added?.map((kw, k) => (
                                  <span key={k} className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 rounded-md px-1.5 py-0.5">
                                    + {kw}
                                  </span>
                                ))}
                                {tip.rewritten_word_count != null && (
                                  <span
                                    title={tip.word_count_match ? 'Same word count as original' : 'Word count could not be matched exactly'}
                                    className={`text-[10px] rounded-md px-1.5 py-0.5 border ${
                                      tip.word_count_match
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                        : 'bg-amber-50 border-amber-200 text-amber-700'
                                    }`}
                                  >
                                    {tip.word_count_match ? '✓' : '≈'} {tip.original_word_count}w → {tip.rewritten_word_count}w
                                  </span>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-gray-700">→ {tip}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  {tipsAreObjects && (
                    <button
                      onClick={() => setShowResume(true)}
                      className="w-full text-xs text-teal-700 hover:text-teal-800 border border-teal-200 hover:border-teal-300 bg-teal-50 hover:bg-teal-100 rounded-lg py-2 transition-colors"
                    >
                      Open in resume — see highlights →
                    </button>
                  )}
                </Section>
              )}

              {/* 4. Top Recommendations */}
              {job.top_recommendations?.length > 0 && (
                <Section label="④ Top Recommendations">
                  <div className="space-y-2">
                    {job.top_recommendations.map((rec, i) => (
                      <div key={i} className="flex gap-2.5 text-xs text-gray-700">
                        <span className="text-teal-600 font-bold shrink-0 mt-0.5">{i + 1}.</span>
                        <span>{rec}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          ) : (
            <div className="text-xs text-gray-400">No JD added — ATS review unavailable.</div>
          )}

          <button
            onClick={() => onDelete(job.id)}
            className="w-full text-xs text-red-600 border border-red-200 rounded-lg py-2 hover:bg-red-50"
          >
            Delete job
          </button>
        </div>
      </div>

      {showResume && <ResumeViewer job={job} onClose={() => setShowResume(false)} />}
    </>
  );
}

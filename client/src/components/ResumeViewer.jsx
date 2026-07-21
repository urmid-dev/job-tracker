import { useState, useEffect, useRef } from 'react';
import { API } from '../api';

const PALETTE = [
  { badge: 'bg-amber-500',  border: 'border-amber-300',  text: 'text-amber-700',  bg: 'bg-amber-50'  },
  { badge: 'bg-blue-500',   border: 'border-blue-300',   text: 'text-blue-700',   bg: 'bg-blue-50'   },
  { badge: 'bg-purple-500', border: 'border-purple-300', text: 'text-purple-700', bg: 'bg-purple-50' },
  { badge: 'bg-emerald-500', border: 'border-emerald-300', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  { badge: 'bg-pink-500',   border: 'border-pink-300',   text: 'text-pink-700',   bg: 'bg-pink-50'   },
];

export default function ResumeViewer({ job, onClose }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [status, setStatus] = useState('Applying highlights…');
  const [activeTip, setActiveTip] = useState(null);
  const blobUrlRef = useRef(null);

  const tips = (job.resume_tips || []).filter(t => typeof t === 'object' && t !== null);
  const phrases = tips.map(t => t.original_text).filter(Boolean);

  useEffect(() => {
    async function load() {
      const pdfBase = job.resume_id ? `${API}/resume-pdf/${job.resume_id}` : `${API}/resume-pdf`;

      if (phrases.length === 0) {
        setStatus(null);
        setPdfUrl(pdfBase);
        return;
      }

      setStatus(`Highlighting ${phrases.length} section${phrases.length > 1 ? 's' : ''}…`);
      try {
        const res = await fetch(`${API}/resume-pdf/highlighted`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phrases, resumeId: job.resume_id }),
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const blob = await res.blob();
        if (blob.type !== 'application/pdf') throw new Error(`Unexpected response type: ${blob.type}`);

        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setPdfUrl(url);
        setStatus(null);
      } catch (err) {
        console.error('Highlight fetch failed:', err);
        setStatus(`Could not apply highlights (${err.message}) — showing plain PDF`);
        setPdfUrl(pdfBase);
      }
    }

    load();
    return () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl shadow-gray-900/10">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 shrink-0">
          <div>
            <div className="text-sm font-medium text-gray-900">Resume · suggested edits</div>
            <div className="text-xs text-gray-500 mt-0.5">{job.company} — {job.role}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Status bar */}
        {status && (
          <div className={`px-5 py-2 text-xs border-b border-gray-200 shrink-0 ${
            status.includes('Could not') ? 'text-amber-700 bg-amber-50' : 'text-gray-500'
          }`}>
            {status}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">

          {/* PDF pane */}
          <div className="flex-1 bg-gray-100 overflow-hidden">
            {pdfUrl
              ? <iframe src={pdfUrl} title="Resume" className="w-full h-full border-0" />
              : <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
            }
          </div>

          {/* Tips pane */}
          <div className="w-80 shrink-0 border-l border-gray-200 overflow-y-auto p-4 space-y-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              {tips.length} suggested {tips.length === 1 ? 'edit' : 'edits'}
            </div>
            {phrases.length > 0 && (
              <p className="text-[10px] text-gray-400 leading-relaxed pb-2 border-b border-gray-200">
                Coloured highlights in the PDF match each numbered edit below.
              </p>
            )}

            {tips.length === 0 && (
              <div className="text-xs text-gray-400">No structured tips for this job.</div>
            )}

            {tips.map((tip, i) => {
              const color = PALETTE[i % PALETTE.length];
              const isActive = activeTip === i;
              return (
                <div
                  key={i}
                  onClick={() => setActiveTip(isActive ? null : i)}
                  className={`rounded-xl border p-3 cursor-pointer transition-all ${
                    isActive ? `${color.border} ${color.bg}` : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white shrink-0 ${color.badge}`}>
                      {i + 1}
                    </span>
                    <span className="text-xs text-gray-500 font-medium truncate">{tip.section || 'Resume'}</span>
                  </div>

                  {tip.original_text && (
                    <div className="mb-2.5">
                      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Original</div>
                      <div className={`text-xs rounded px-2 py-1.5 font-mono leading-relaxed line-through ${color.text} bg-gray-50`}>
                        "{tip.original_text}"
                      </div>
                    </div>
                  )}

                  <div className="mb-2.5">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">STAR rewrite</div>
                    <div className="text-xs text-gray-700 leading-relaxed bg-gray-50 rounded px-2 py-1.5">
                      {tip.rewritten || tip.suggested_text}
                    </div>
                  </div>

                  {tip.reason && (
                    <div className="text-[10px] text-gray-500 leading-relaxed border-t border-gray-200 pt-2">
                      {tip.reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import api from '../api';

export default function ResumeUpload({ onClose, onUploaded }) {
  const [resumes, setResumes] = useState([]);       // all uploaded versions
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activating, setActivating] = useState(null); // id being activated
  const [deleting, setDeleting] = useState(null);      // id being deleted
  const [result, setResult] = useState(null);       // { filename } on success
  const [error, setError] = useState('');
  const inputRef = useRef();

  function refresh() {
    return api.get('/resumes').then(r => setResumes(r.data)).catch(() => {});
  }

  useEffect(() => { refresh(); }, []);

  async function upload(file) {
    if (!file || file.type !== 'application/pdf') {
      setError('Please drop a PDF file.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('resume', file);
      const res = await api.post('/resume', form);
      setResult(res.data);
      await refresh();
      onUploaded?.();
    } catch (e) {
      setError(e.response?.data?.error || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function activate(id) {
    setActivating(id);
    try {
      await api.post(`/resumes/${id}/activate`);
      await refresh();
      onUploaded?.();
    } finally {
      setActivating(null);
    }
  }

  async function remove(id) {
    setDeleting(id);
    try {
      await api.delete(`/resumes/${id}`);
      await refresh();
      onUploaded?.();
    } finally {
      setDeleting(null);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files[0]);
  }

  function formatSize(bytes) {
    return bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-md p-6 shadow-2xl shadow-gray-900/10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-medium text-gray-900">Your resume versions</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {/* Success state */}
        {result && (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4">
            <span className="text-emerald-600 text-lg shrink-0">✓</span>
            <div>
              <div className="text-xs font-medium text-emerald-700">{result.filename}</div>
              <div className="text-[10px] text-emerald-600 mt-0.5">Uploaded as a new version and set active</div>
            </div>
          </div>
        )}

        {/* Version list */}
        {resumes.length > 0 && (
          <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
            {resumes.map(r => (
              <div
                key={r.id}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${
                  r.is_active ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="w-8 h-8 bg-red-50 border border-red-200 rounded-lg flex items-center justify-center shrink-0">
                  <span className="text-red-600 text-[9px] font-bold">PDF</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-900 truncate">{r.original_name}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {r.size != null && `${formatSize(r.size)} · `}uploaded {formatDate(r.uploaded_at)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {r.is_active ? (
                    <span className="text-[10px] text-emerald-700 font-medium">✓ Active</span>
                  ) : (
                    <button
                      onClick={() => activate(r.id)}
                      disabled={activating === r.id || deleting === r.id}
                      className="text-[10px] text-teal-700 hover:text-teal-800 border border-teal-200 hover:border-teal-300 rounded-md px-2 py-1 disabled:opacity-40"
                    >
                      {activating === r.id ? '...' : 'Use this'}
                    </button>
                  )}
                  <button
                    onClick={() => remove(r.id)}
                    disabled={deleting === r.id || activating === r.id}
                    title="Delete this resume"
                    className="text-[10px] text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-md px-2 py-1 disabled:opacity-40"
                  >
                    {deleting === r.id ? '...' : '🗑'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            dragging
              ? 'border-teal-500 bg-teal-50'
              : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={e => upload(e.target.files[0])}
          />
          {uploading ? (
            <div className="text-sm text-gray-500">Uploading…</div>
          ) : (
            <>
              <div className="text-2xl mb-2">📄</div>
              <div className="text-sm text-gray-700 font-medium mb-1">
                {dragging ? 'Drop it!' : 'Drop your resume here'}
              </div>
              <div className="text-xs text-gray-400">or click to browse · PDF only · max 10 MB</div>
            </>
          )}
        </div>

        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

        <p className="text-[10px] text-gray-400 mt-4 leading-relaxed">
          Your resumes are stored locally on this server and used only for AI fit scoring.
          Uploading a new file adds it as a version — older versions stay available to pick from
          when adding a job.
        </p>

        <button
          onClick={onClose}
          className="w-full mt-4 text-sm text-gray-600 border border-gray-300 rounded-lg py-2 hover:bg-gray-50"
        >
          {result ? 'Done' : 'Close'}
        </button>
      </div>
    </div>
  );
}

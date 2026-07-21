import { useState, useEffect } from 'react';
import api from './api';
import StatsStrip from './components/StatsStrip';
import JobList from './components/JobList';
import CoachPanel from './components/CoachPanel';
import AddJobModal from './components/AddJobModal';
import ResumeUpload from './components/ResumeUpload';
import GmailConnect from './components/GmailConnect';
import LoginModal from './components/LoginModal';

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({});
  const [selectedJob, setSelectedJob] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [showGmail, setShowGmail] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [resumeUploaded, setResumeUploaded] = useState(null); // null=unknown, true, false
  const [gmailStatus, setGmailStatus] = useState({});
  const [loading, setLoading] = useState(true);

  function refreshGmailStatus() {
    if (!isOwner) return;
    return api.get('/gmail/status').then(r => setGmailStatus(r.data)).catch(() => {});
  }

  function refreshAuth() {
    return api.get('/auth/status').then(r => {
      setAuthenticated(r.data.authenticated);
      setIsOwner(Boolean(r.data.isOwner));
    }).catch(() => { setAuthenticated(false); setIsOwner(false); }).finally(() => setAuthChecked(true));
  }

  async function fetchAll() {
    const [jobsRes, statsRes] = await Promise.all([
      api.get('/jobs'),
      api.get('/stats'),
    ]);
    setJobs(jobsRes.data);
    setStats(statsRes.data);
    setLoading(false);
  }

  useEffect(() => {
    refreshAuth();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    fetchAll();
    api.get('/resume/status').then(r => setResumeUploaded(r.data.uploaded)).catch(() => setResumeUploaded(false));
    refreshGmailStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  async function addJob(data) {
    const res = await api.post('/jobs', data);
    setJobs(prev => [res.data, ...prev]);
    fetchAll();
    setSelectedJob(res.data);
  }

  async function deleteJob(id) {
    await api.delete(`/jobs/${id}`);
    setJobs(prev => prev.filter(j => j.id !== id));
    setSelectedJob(null);
    fetchAll();
  }

  async function updateJobStatus(id, status) {
    await api.patch(`/jobs/${id}/status`, { status });
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status } : j));
    setSelectedJob(prev => prev && prev.id === id ? { ...prev, status } : prev);
    fetchAll();
  }

  async function logout() {
    await api.post('/auth/logout');
    setAuthenticated(false);
    setIsOwner(false);
    setJobs([]);
    setStats({});
    setSelectedJob(null);
    setResumeUploaded(null);
    setGmailStatus({});
  }

  if (!authChecked) {
    return <div className="flex items-center justify-center h-screen text-gray-400 text-sm bg-slate-50">Loading…</div>;
  }

  if (!authenticated) {
    return <LoginModal onLoggedIn={refreshAuth} />;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-16 bg-white border-b border-gray-200 shrink-0 shadow-[0_1px_2px_0_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">JT</span>
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-gray-900">JobTrack AI</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Resume indicator button */}
          <button
            onClick={() => setShowResume(true)}
            className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors ${
              resumeUploaded
                ? 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                : 'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${resumeUploaded ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span>{resumeUploaded ? 'Resume' : 'Upload resume'}</span>
          </button>

          {/* Gmail sync button — visible to everyone; non-owners get an
              explanatory message instead of the connect flow when they open it
              (see GmailConnect.jsx). */}
          <button
            onClick={() => setShowGmail(true)}
            className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors ${
              gmailStatus.connected && !gmailStatus.needsReconnect
                ? 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                : 'bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${gmailStatus.connected && !gmailStatus.needsReconnect ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span>
              Gmail{gmailStatus.pendingSuggestions > 0 ? ` · ${gmailStatus.pendingSuggestions}` : ''}
            </span>
          </button>

          <div className="w-px h-5 bg-gray-200 mx-1" />

          <button
            onClick={() => setShowModal(true)}
            className="text-xs bg-teal-600 hover:bg-teal-700 text-white px-3.5 py-2 rounded-lg font-medium shadow-sm shadow-teal-900/10 transition-colors"
          >
            + Add Job
          </button>

          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2"
          >
            Sign out
          </button>
        </div>
      </div>

      <StatsStrip stats={stats} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
          ) : (
            <JobList
              jobs={jobs}
              selectedId={selectedJob?.id}
              onSelect={setSelectedJob}
            />
          )}
        </div>
        {selectedJob && (
          <CoachPanel
            job={selectedJob}
            onClose={() => setSelectedJob(null)}
            onDelete={(id) => { deleteJob(id); }}
            onStatusChange={updateJobStatus}
          />
        )}
      </div>

      {showModal && (
        <AddJobModal
          onClose={() => setShowModal(false)}
          onAdd={addJob}
        />
      )}

      {showResume && (
        <ResumeUpload
          onClose={() => setShowResume(false)}
          onUploaded={() => setResumeUploaded(true)}
        />
      )}

      {showGmail && (
        <GmailConnect
          onClose={() => setShowGmail(false)}
          onChange={() => { refreshGmailStatus(); fetchAll(); }}
        />
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import api, { API } from '../api';

function timeAgo(iso) {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function progressText(p) {
  if (!p) return '';
  if (p.phase === 'searching') return 'Searching your inbox for emails from tracked companies…';
  if (p.phase === 'filtering') return `Looking through ${p.filtered} of ${p.scanned} emails…`;
  return `Checking ${p.classified} of ${p.toClassify} matching emails with AI…`;
}

function summaryText(s) {
  if (!s) return '';
  const parts = [`${s.scanned} emails found`];
  if (s.appliedCount) parts.push(`${s.appliedCount} job${s.appliedCount === 1 ? '' : 's'} updated`);
  if (s.pendingCount) parts.push(`${s.pendingCount} to review`);
  if (s.skippedBulk) parts.push(`${s.skippedBulk} job alerts skipped`);
  let text = parts.join(' · ');
  if (s.remaining) text += ` — ${s.remaining} more to check on the next sync`;
  if (s.errors?.includes('rate_limited')) text += ' (AI rate limit reached; the rest will be checked next time)';
  return text;
}

export default function GmailConnect({ onClose, onChange }) {
  const [status, setStatus] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [acting, setActing] = useState(null); // suggestion id being accepted/dismissed
  const [error, setError] = useState('');
  const [ownerOnly, setOwnerOnly] = useState(false);
  const pollRef = useRef(null);

  function refresh() {
    return Promise.all([
      api.get('/gmail/status'),
      api.get('/gmail/suggestions'),
    ]).then(([s, sug]) => {
      setStatus(s.data);
      setSuggestions(sug.data);
    }).catch(e => {
      if (e.response?.status === 403) setOwnerOnly(true);
    });
  }

  function stopPolling() {
    clearInterval(pollRef.current);
    pollRef.current = null;
  }

  // While a sync runs (possibly started by the daily cron or an earlier
  // click), poll status for live progress until it finishes.
  function startPolling() {
    if (pollRef.current) return;
    setSyncing(true);
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.get('/gmail/status');
        setStatus(s.data);
        if (!s.data.syncProgress) {
          stopPolling();
          setSyncing(false);
          await refresh();
          onChange?.();
        }
      } catch {
        stopPolling();
        setSyncing(false);
      }
    }, 2000);
  }

  useEffect(() => {
    refresh();
    api.get('/gmail/status').then(s => { if (s.data.syncProgress) startPolling(); }).catch(() => {});
    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connect() {
    const popup = window.open(`${API}/gmail/connect`, 'gmail-oauth', 'width=500,height=650');
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        refresh();
        onChange?.();
      }
    }, 1000);
  }

  async function syncNow() {
    setError('');
    startPolling();
    try {
      await api.post('/gmail/sync-now');
    } catch (e) {
      // 409 = a sync is already running; keep showing its progress.
      if (e.response?.status !== 409) {
        stopPolling();
        setSyncing(false);
        setError(e.response?.data?.error || 'Sync failed. Please try again.');
      }
    }
  }

  async function disconnectGmail() {
    setDisconnecting(true);
    try {
      await api.post('/gmail/disconnect');
      await refresh();
      onChange?.();
    } finally {
      setDisconnecting(false);
    }
  }

  async function accept(id) {
    setActing(id);
    try {
      await api.post(`/gmail/suggestions/${id}/accept`);
      await refresh();
      onChange?.();
    } finally {
      setActing(null);
    }
  }

  async function dismiss(id) {
    setActing(id);
    try {
      await api.post(`/gmail/suggestions/${id}/dismiss`);
      await refresh();
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-md p-6 shadow-2xl shadow-gray-900/10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-medium text-gray-900">Gmail sync</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {ownerOnly ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-3">
            <p className="text-xs text-gray-500 leading-relaxed mb-2.5">
              Gmail sync scans your inbox once a day to auto-detect rejection,
              interview and offer emails and update the matching job's status for
              you, so you don't have to track it manually.
            </p>
            <p className="text-xs text-gray-600 leading-relaxed">
              This isn't available on your account. This is a personal
              project, not a multi-tenant product — connecting Gmail requires
              Google's app-verification review for every extra account, so
              it's only set up for the project owner for now.
            </p>
            <p className="text-xs text-gray-500 leading-relaxed mt-2.5">
              Everything else still works fully for you — AI/ATS resume
              review and scoring, and tracking job status by hand.
            </p>
          </div>
        ) : (
          <>
            {!status.connected && (
              <>
                <p className="text-xs text-gray-500 leading-relaxed mb-4">
                  Connect your Gmail to automatically detect rejection, interview and offer emails for
                  jobs you've applied to, and update their status once a day.
                </p>
                <button
                  onClick={connect}
                  className="w-full text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg py-2 font-medium shadow-sm shadow-teal-900/10 transition-colors"
                >
                  Connect Gmail
                </button>
              </>
            )}

            {status.connected && status.needsReconnect && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4">
                <p className="text-xs text-amber-700 mb-2">
                  Gmail authorization expired — reconnect to keep syncing.
                </p>
                <button
                  onClick={connect}
                  className="w-full text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg py-1.5 font-medium"
                >
                  Reconnect Gmail
                </button>
              </div>
            )}

            {status.connected && !status.needsReconnect && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mb-4">
                <div className="text-xs font-medium text-gray-900">Connected as {status.email}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">Last synced: {timeAgo(status.lastSyncAt)}</div>
                {status.syncProgress ? (
                  <div className="mt-2">
                    <div className="text-[10px] text-teal-700">{progressText(status.syncProgress)}</div>
                    {status.syncProgress.phase === 'classifying' && status.syncProgress.toClassify > 0 && (
                      <div className="h-1 bg-gray-200 rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-teal-500 transition-all"
                          style={{ width: `${Math.round(100 * status.syncProgress.classified / status.syncProgress.toClassify)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ) : status.lastSyncSummary && (
                  <div className="text-[10px] text-gray-500 mt-1">{summaryText(status.lastSyncSummary)}</div>
                )}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={syncNow}
                    disabled={syncing || disconnecting}
                    className="flex-1 text-xs text-teal-700 hover:text-teal-800 border border-teal-200 hover:border-teal-300 rounded-lg py-1.5 disabled:opacity-40"
                  >
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                  <button
                    onClick={disconnectGmail}
                    disabled={syncing || disconnecting}
                    title="Disconnect this account so you can connect a different one"
                    className="flex-1 text-xs text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-lg py-1.5 disabled:opacity-40"
                  >
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

            {suggestions.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  Pending review ({suggestions.length})
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {suggestions.map(s => (
                    <div key={s.id} className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-gray-900 truncate">{s.company} — {s.role}</span>
                        <span className={`text-[10px] rounded-md px-1.5 py-0.5 shrink-0 ml-2 ${
                          s.classification === 'rejected'
                            ? 'bg-red-50 border border-red-200 text-red-700'
                            : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                        }`}>
                          {s.classification}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-500 mb-1 truncate">{s.subject}</div>
                      <div className="text-[10px] text-gray-400 mb-2 line-clamp-2">{s.snippet}</div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => accept(s.id)}
                          disabled={acting === s.id}
                          className="flex-1 text-[10px] text-emerald-700 hover:text-emerald-800 border border-emerald-200 hover:border-emerald-300 rounded-md py-1 disabled:opacity-40"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => dismiss(s.id)}
                          disabled={acting === s.id}
                          className="flex-1 text-[10px] text-gray-500 hover:text-gray-700 border border-gray-300 hover:border-gray-400 rounded-md py-1 disabled:opacity-40"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <button
          onClick={onClose}
          className="w-full mt-4 text-sm text-gray-600 border border-gray-300 rounded-lg py-2 hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    </div>
  );
}

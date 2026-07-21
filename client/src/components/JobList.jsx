const fitColor = (score) => {
  if (!score) return { text: 'text-gray-500', bg: 'bg-gray-100', label: 'No JD' };
  if (score >= 80) return { text: 'text-emerald-700', bg: 'bg-emerald-50', label: `${score}%` };
  if (score >= 60) return { text: 'text-amber-700', bg: 'bg-amber-50', label: `${score}%` };
  return { text: 'text-red-700', bg: 'bg-red-50', label: `${score}%` };
};

const COLUMNS = [
  { key: 'applied', label: 'Applied', dot: 'bg-blue-500' },
  { key: 'interview', label: 'Interview', dot: 'bg-amber-500' },
  { key: 'rejected', label: 'Rejected', dot: 'bg-red-500' },
  { key: 'offer', label: 'Offer', dot: 'bg-emerald-500' },
];

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const iso = dateStr.includes('T') || dateStr.includes(' ') ? dateStr.replace(' ', 'T') : dateStr;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function JobCard({ job, selected, onClick }) {
  const fit = fitColor(job.fit_score);
  const noSponsor = job.sponsors === false;

  return (
    <div
      onClick={onClick}
      className={`group border rounded-xl p-4 cursor-pointer transition-all ${
        selected
          ? 'border-teal-500/70 bg-white shadow-md shadow-gray-900/[0.06]'
          : 'border-gray-200 hover:border-gray-300 bg-white/70 hover:bg-white hover:shadow-md hover:shadow-gray-900/[0.04]'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{job.company}</div>
          <div className="text-sm font-medium text-gray-900 leading-snug">{job.role}</div>
        </div>
        <div className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-lg ${fit.bg} ${fit.text}`}>
          {fit.label}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        <span className="text-[10px] text-gray-400" title="Date of current status">
          {formatShortDate(job.status_updated_at || job.applied_date)}
        </span>
        {noSponsor && (
          <span className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
            No sponsorship
          </span>
        )}
        {job.sponsors === true && (
          <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
            Sponsors
          </span>
        )}
        {job.fit_verdict && (
          <span className="text-[10px] text-gray-400">{job.fit_verdict}</span>
        )}
      </div>
    </div>
  );
}

export default function JobList({ jobs, selectedId, onSelect }) {
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="text-3xl mb-3">🎯</div>
        <div className="text-sm text-gray-700 font-medium mb-1">No jobs tracked yet</div>
        <div className="text-xs text-gray-400">Click "+ Add Job" and paste a LinkedIn URL to get started</div>
      </div>
    );
  }

  return (
    <div className="flex gap-5 p-6 h-full overflow-x-auto">
      {COLUMNS.map(col => {
        const colJobs = jobs.filter(j => (j.status || 'applied') === col.key);
        return (
          <div key={col.key} className="flex flex-col w-72 shrink-0">
            <div className="flex items-center gap-2 mb-3.5 px-0.5 pb-2.5 border-b border-gray-200 shrink-0">
              <span className={`w-2 h-2 rounded-full ${col.dot}`} />
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{col.label}</span>
              <span className="text-[10px] text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5 ml-auto font-medium">{colJobs.length}</span>
            </div>
            <div className="flex flex-col gap-2.5 overflow-y-auto flex-1">
              {colJobs.map(job => (
                <JobCard
                  key={job.id}
                  job={job}
                  selected={job.id === selectedId}
                  onClick={() => onSelect(job)}
                />
              ))}
              {colJobs.length === 0 && (
                <div className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">
                  No jobs here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StatsStrip({ stats }) {
  const items = [
    {
      label: 'Jobs tracked',
      value: stats.total ?? 0,
      sub: 'total'
    },
    {
      label: 'Avg ATS score',
      value: stats.avgScore ? `${stats.avgScore}%` : '—',
      sub: stats.avgScore >= 80 ? 'strong' : stats.avgScore >= 60 ? 'good' : stats.avgScore ? 'needs work' : 'add a JD',
      valueColor: stats.avgScore >= 80 ? 'text-emerald-600' : stats.avgScore >= 60 ? 'text-amber-600' : stats.avgScore ? 'text-red-600' : ''
    },
    {
      label: 'Strong matches',
      value: stats.strongMatches ?? 0,
      sub: 'score ≥ 80%',
      valueColor: stats.strongMatches > 0 ? 'text-emerald-600' : ''
    },
    {
      label: 'No sponsorship',
      value: stats.noSponsorship ?? 0,
      sub: 'flagged jobs',
      valueColor: stats.noSponsorship > 0 ? 'text-red-600' : ''
    }
  ];

  return (
    <div className="grid grid-cols-4 gap-3 px-6 py-4 bg-slate-50 shrink-0">
      {items.map(item => (
        <div key={item.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3.5 shadow-sm shadow-gray-900/[0.03]">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5">{item.label}</div>
          <div className={`text-2xl font-semibold tabular-nums ${item.valueColor || 'text-gray-900'}`}>{item.value}</div>
          {item.sub && <div className="text-[10px] text-gray-400 mt-1">{item.sub}</div>}
        </div>
      ))}
    </div>
  );
}

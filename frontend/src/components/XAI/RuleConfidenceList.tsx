import React from 'react';

interface RuleResult {
  label: string;
  score: number;
  actual: string | number;
  pass: boolean;
}

interface RuleConfidenceListProps {
  results: RuleResult[];
}

const RuleConfidenceList: React.FC<RuleConfidenceListProps> = ({ results }) => {
  if (!results || results.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 space-y-4">
      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
        Rule Confidence Breakdown
      </h3>
      <div className="grid gap-3">
        {results.map((rule, index) => (
          <div
            key={index}
            className="group relative flex items-center gap-4 p-3 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-blue-500/50 transition-colors"
          >
            {/* Status Icon */}
            <div className="flex-shrink-0">
              {rule.pass ? (
                <span className="text-emerald-500 text-lg" title="Passed">✅</span>
              ) : (
                <span className="text-rose-500 text-lg" title="Failed">🚫</span>
              )}
            </div>

            {/* Rule Label */}
            <div className="flex-grow min-w-0">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-slate-200 truncate pr-2">
                  {rule.label}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  {(rule.score * 100).toFixed(0)}%
                </span>
              </div>

              {/* Confidence Bar */}
              <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ease-out ${
                    rule.score > 0.8 ? 'bg-emerald-500' :
                    rule.score > 0.5 ? 'bg-amber-500' : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, rule.score * 100))}%` }}
                />
              </div>
            </div>

            {/* XAI Tooltip - simple CSS implementation */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
              <div className="bg-slate-900 text-slate-200 text-xs py-1 px-2 rounded border border-slate-600 whitespace-nowrap shadow-xl">
                Actual: <span className="font-mono text-blue-400">{rule.actual}</span>
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RuleConfidenceList;

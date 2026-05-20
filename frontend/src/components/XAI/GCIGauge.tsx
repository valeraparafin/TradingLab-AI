import React from 'react';

interface GCIGaugeProps {
  value: number; // 0.0 to 1.0
}

const GCIGauge: React.FC<GCIGaugeProps> = ({ value }) => {
  // Clamp value between 0 and 1
  const clampedValue = Math.min(Math.max(value, 0), 1);

  // Calculate color based on value
  const getColor = (val: number) => {
    if (val < 0.4) return 'text-red-500 fill-red-500 stroke-red-500';
    if (val < 0.7) return 'text-yellow-500 fill-yellow-500 stroke-yellow-500';
    return 'text-green-500 fill-green-500 stroke-green-500';
  };

  const colorClass = getColor(clampedValue);

  // SVG Constants
  const radius = 40;
  const circumference = Math.PI * radius; // Semi-circle
  const strokeWidth = 10;
  const offset = circumference - clampedValue * circumference;

  return (
    <div className="flex flex-col items-center justify-center p-4 bg-slate-900/50 rounded-xl border border-slate-800 w-full max-w-[200px]">
      <div className="relative w-32 h-16 overflow-hidden">
        <svg
          viewBox="0 0 100 50"
          className="w-full h-full transform rotate-0"
        >
          {/* Background Track */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className="text-slate-700"
          />
          {/* Value Track */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={offset}
            className={`${colorClass} transition-all duration-500 ease-out`}
          />
        </svg>

        {/* Percentage Label */}
        <div className="absolute bottom-0 left-0 right-0 text-center pb-1">
          <span className={`text-2xl font-bold ${colorClass}`}>
            {Math.round(clampedValue * 100)}%
          </span>
        </div>
      </div>
      <span className="mt-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
        Confidence Index
      </span>
    </div>
  );
};

export default GCIGauge;

import React from 'react';
import { PieChart, Pie } from "recharts";

interface GCIGaugeProps {
  value: number; // 0.0 to 1.0
}

const GCIGauge: React.FC<GCIGaugeProps> = ({ value }) => {
  const isLoading = value === 0;
  const clampedValue = Math.min(Math.max(value, 0), 1);

  const getColor = (val: number) => {
    if (val < 0.4) return { color: '#fca5a5', label: 'text-rose-500' }; // Pastel rose-300
    if (val < 0.7) return { color: '#fcd34d', label: 'text-amber-500' }; // Pastel amber-300
    return { color: '#6ee7b7', label: 'text-emerald-500' }; // Pastel emerald-300
  };

  const theme = getColor(clampedValue);

  return (
    <div className="flex flex-col items-center justify-center relative w-40 h-40">
      <div className="relative w-full h-full flex items-center justify-center">
        <PieChart width={160} height={160}>
          {/* Background Track - Full Circle */}
          <Pie
            data={[{ value: 100 }]}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={75}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            fill={isLoading ? '#f4f4f5' : '#f4f4f5'}
            className={isLoading ? 'animate-pulse' : ''}
          />
          {/* Active Value Arc - Partial Circle */}
          {!isLoading && (
            <Pie
              data={[{ value: clampedValue * 100 }]}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={75}
              startAngle={90}
              endAngle={90 - (clampedValue * 360)}
              stroke="none"
              fill={theme.color}
              cornerRadius={5}
            />
          )}
        </PieChart>

        {/* Centered Text Overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center">
              <div className="h-8 w-16 bg-zinc-200 rounded animate-pulse mb-2" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-300 animate-pulse">
                Calculating...
              </span>
            </div>
          ) : (
            <>
              <span className={`text-3xl font-bold font-mono ${theme.label}`}>
                {Math.round(clampedValue * 100)}%
              </span>
              <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-400">
                Confidence
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GCIGauge;

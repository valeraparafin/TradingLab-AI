import React from 'react';
import {
  Label,
  PolarGrid,
  PolarRadiusAxis,
  RadialBar,
  RadialBarChart,
} from "recharts";

interface GCIGaugeProps {
  value: number; // 0.0 to 1.0
}

const GCIGauge: React.FC<GCIGaugeProps> = ({ value }) => {
  const clampedValue = Math.min(Math.max(value, 0), 1);

  const getColor = (val: number) => {
    if (val < 0.4) return { color: '#fca5a5', label: 'text-rose-500' }; // Pastel rose-300 for bar, accent rose-500 for text
    if (val < 0.7) return { color: '#fcd34d', label: 'text-amber-500' }; // Pastel amber-300 for bar, accent amber-500 for text
    return { color: '#6ee7b7', label: 'text-emerald-500' }; // Pastel emerald-300 for bar, accent emerald-500 for text
  };

  const theme = getColor(clampedValue);

  // Fix: Recharts RadialBar expects values that correlate to the data scale.
  // To get exactly X% of the circle, we need to ensure the data and the chart scale match.
  const chartData = [
    {
      name: "GCI",
      value: clampedValue * 100,
      fill: theme.color,
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center relative w-40 h-40">
      <div className="relative w-full h-full flex items-center justify-center">
        <RadialBarChart
          width={160}
          height={160}
          innerRadius={55}
          outerRadius={75}
          barSize={10}
          data={chartData}
          startAngle={90}
          endAngle={-270}
          cx="50%"
          cy="50%"
        >
          {/*
            Fix: Remove PolarGrid as it was creating the full circle fill.
            We use the RadialBar's own background prop for the track.
          */}
          <RadialBar
            dataKey="value"
            background={{ fill: '#f4f4f5' }} // Light zinc background
            cornerRadius={5}
          />

          <PolarRadiusAxis tick={false} tickLine={false} axisLine={false} domain={[0, 100]}>
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                  return (
                    <text
                      x={viewBox.cx}
                      y={viewBox.cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={viewBox.cx}
                        y={viewBox.cy}
                        className={`text-3xl font-bold font-mono fill-zinc-900 ${theme.label}`}
                      >
                        {Math.round(clampedValue * 100)}%
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy || 0) + 20}
                        className="fill-zinc-400 text-[10px] font-medium uppercase tracking-widest"
                      >
                        Confidence
                      </tspan>
                    </text>
                  );
                }
                return null;
              }}
            />
          </PolarRadiusAxis>
        </RadialBarChart>
      </div>
    </div>
  );
};

export default GCIGauge;

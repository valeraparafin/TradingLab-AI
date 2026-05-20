import React from 'react';
import { motion } from 'framer-motion';
import { SymmetricBar } from './SymmetricBar';

interface RuleResult {
  label: string;
  score: number;
  actual: string | number;
  pass: boolean;
}

interface RuleConfidenceListProps {
  results: RuleResult[];
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

const RuleItem: React.FC<{ rule: RuleResult; index: number }> = ({ rule, index }) => {
  const labelLower = rule.label.toLowerCase();

  // 1. Type Detection
  const isOscillator = labelLower.includes('wavetrend') ||
                       labelLower.includes('oscillator') ||
                       labelLower.includes('mfi') ||
                       (typeof rule.actual === 'number' && Math.abs(rule.actual) > 1 && Math.abs(rule.actual) <= 150);

  const isTrend = labelLower.includes('trend') || labelLower.includes('state');

  const binaryKeywords = ['cross', 'detected'];
  const isBinaryLabel = binaryKeywords.some(k => labelLower.includes(k));
  const isBooleanActual = typeof rule.actual === 'boolean' ||
                          rule.actual === 'true' ||
                          rule.actual === 'false';

  const shouldTreatAsBinary = (typeof rule.actual !== 'number') && (isBooleanActual || isBinaryLabel);

  // 2. Logic Mapping
  let symmetricValue = 0;
  let scoreLabel = '';
  let barColor = 'bg-zinc-400';

  if (isOscillator) {
    // Oscillators (WaveTrend, MFI)
    // If actual is e.g. -60, symmetricValue = -0.6
    const rawValue = typeof rule.actual === 'number' ? rule.actual : rule.score;
    symmetricValue = rawValue > 1 || rawValue < -1 ? rawValue / 100 : rawValue;

    const sign = symmetricValue < 0 ? '-' : '';
    scoreLabel = `${sign}${Math.abs(symmetricValue * 100).toFixed(1)}%`;

    const absVal = Math.abs(symmetricValue * 100);
    barColor = symmetricValue >= 0
      ? (absVal >= 53 ? 'bg-emerald-500' : 'bg-emerald-300')
      : (absVal >= 53 ? 'bg-rose-500' : 'bg-rose-300');

  } else if (isTrend) {
    // Trend/States
    const trendVal = String(rule.actual).toUpperCase();
    if (trendVal.includes('BULLISH')) {
      symmetricValue = 1.0;
      scoreLabel = 'BULLISH';
      barColor = 'bg-emerald-500';
    } else if (trendVal.includes('BEARISH')) {
      symmetricValue = -1.0;
      scoreLabel = 'BEARISH';
      barColor = 'bg-rose-500';
    } else {
      symmetricValue = 0;
      scoreLabel = 'NEUTRAL';
      barColor = 'bg-zinc-400';
    }
  } else if (shouldTreatAsBinary) {
    // Binary Signals (Crosses, Detections)
    symmetricValue = rule.pass ? 1.0 : -1.0;
    scoreLabel = rule.pass ? 'ACTIVE' : 'INACTIVE';
    barColor = rule.pass ? 'bg-emerald-500' : 'bg-rose-500';
  } else {
    // Default fallback
    symmetricValue = rule.score;
    scoreLabel = `${(rule.score * 100).toFixed(1)}%`;
    barColor = rule.score > 0.5 ? 'bg-emerald-500' : 'bg-rose-500';
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group relative flex flex-col p-3 rounded-xl bg-white border border-zinc-200 shadow-sm hover:border-zinc-300 transition-all duration-200"
    >
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            rule.pass ? "bg-emerald-500" : "bg-rose-500"
          )} />
          <span className="text-xs font-semibold text-zinc-600 truncate">{rule.label}</span>
        </div>
        <span className="text-[10px] font-mono font-bold uppercase text-zinc-400">
          {scoreLabel}
        </span>
      </div>

      <SymmetricBar
        value={symmetricValue}
        color={barColor}
        isBinary={shouldTreatAsBinary || isTrend}
      />

      <div className="absolute inset-0 bg-white/90 backdrop-blur-sm rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center p-2 text-center pointer-events-none border border-zinc-200 shadow-inner">
        <span className="text-[10px] uppercase text-zinc-400 font-bold mb-1">Actual Value</span>
        <span className="text-xs font-mono text-blue-600 font-bold truncate w-full">{rule.actual}</span>
      </div>
    </motion.div>
  );
};

const RuleConfidenceList: React.FC<RuleConfidenceListProps> = ({ results }) => {
  if (!results || results.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
      {results.map((rule, index) => (
        <RuleItem key={index} rule={rule} index={index} />
      ))}
    </div>
  );
};

export default RuleConfidenceList;

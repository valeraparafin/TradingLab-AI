import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface SymmetricBarProps {
  value: number; // Can be normalized (-1 to 1) or raw (-100 to 100)
  color: string;
  isBinary?: boolean;
  className?: string;
}

export const SymmetricBar: React.FC<SymmetricBarProps> = ({ value, color, isBinary = false, className }) => {
  // Normalize value to be between -1 and 1
  // If value is e.g. -65, it becomes -0.65. If it's 0.65, it stays 0.65.
  const normalizedValue = Math.abs(value) > 1 ? value / 100 : value;
  const clampedValue = Math.max(-1, Math.min(1, normalizedValue));

  const absVal = Math.abs(clampedValue);
  const percentage = absVal * 100;
  const isPositive = clampedValue >= 0;

  return (
    <div className={cn('relative h-2 w-full bg-zinc-100 rounded-full overflow-hidden', className)}>
      {/* Center Marker */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-300 z-10" />

      {/* The Active Bar */}
      <motion.div
        initial={false}
        animate={{
          width: `${percentage}%`,
          left: isPositive ? '50%' : `${50 - percentage}%`
        }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30
        }}
        className={cn(
          'absolute top-0 bottom-0 h-full rounded-full transition-colors duration-500',
          color.startsWith('bg-') ? color : ''
        )}
        style={!color.startsWith('bg-') ? { backgroundColor: color } : {}}
      />
    </div>
  );
};

SymmetricBar.displayName = 'SymmetricBar';

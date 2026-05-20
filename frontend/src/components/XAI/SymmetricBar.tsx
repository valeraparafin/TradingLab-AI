import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SymmetricBarProps {
  /** Normalized value from -1 to 1 */
  value: number;
  /** Color for the bar (e.g., 'bg-emerald-500' or '#10b981') */
  color: string;
  /** Whether the value is binary (0 or 1 / 0 or -1) */
  isBinary?: boolean;
  /** Additional classes for the container */
  className?: string;
}

export const SymmetricBar: React.FC<SymmetricBarProps> = ({
  value,
  color,
  isBinary = false,
  className,
}) => {
  // Clamp value between -1 and 1
  const clampedValue = Math.max(-1, Math.min(1, value));
  const absValue = Math.abs(clampedValue);
  const percentage = absValue * 100;

  // Positioning Logic:
  // If value >= 0: left is 50%, width is percentage%
  // If value < 0: left is 50% - percentage%, width is percentage%
  const leftPosition = clampedValue >= 0 ? '50%' : `${50 - percentage}%`;

  return (
    <div className={cn('relative w-full h-2 bg-zinc-100 rounded-full overflow-hidden', className)}>
      {/* Center Marker */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-300 z-10" />

      <motion.div
        initial={false}
        animate={{
          left: leftPosition,
          width: `${percentage}%`,
        }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30,
        }}
        className={cn(
          'absolute top-0 bottom-0 h-full rounded-full',
          color.startsWith('bg-') ? color : ''
        )}
        style={!color.startsWith('bg-') ? { backgroundColor: color } : {}}
      />
    </div>
  );
};

SymmetricBar.displayName = 'SymmetricBar';

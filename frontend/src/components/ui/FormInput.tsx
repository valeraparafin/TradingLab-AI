import React from 'react';
import { Tooltip } from './tooltip';

interface FormInputProps {
  label: string;
  value: any;
  onChange: (value: any) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'select' | 'checkbox';
  options?: { label: string; value: string }[];
  className?: string;
  tooltip?: string;
}

export const FormInput = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  options,
  className = '',
  tooltip
}: FormInputProps) => {
  const commonClass = "w-full p-2 rounded border bg-background text-sm";

  return (
    <div className={className}>
      <div className="flex items-center gap-1 mb-1">
        <label className="block text-xs font-medium">{label}</label>
        {tooltip && (
          <Tooltip content={tooltip}>
            <span className="text-muted-foreground cursor-help">ⓘ</span>
          </Tooltip>
        )}
      </div>
      {type === 'select' ? (
        <select
          className={commonClass}
          value={value}
          onChange={e => onChange(e.target.value)}
        >
          <option value="" disabled={options?.length > 0}>
            {options?.length ? "Select an option..." : "No templates found..."}
          </option>
          {options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : type === 'checkbox' ? (
        <div className="flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            checked={value}
            onChange={e => onChange(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-xs font-medium">{label}</span>
        </div>
      ) : (
        <input
          type={type}
          className={commonClass}
          value={value}
          onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
};

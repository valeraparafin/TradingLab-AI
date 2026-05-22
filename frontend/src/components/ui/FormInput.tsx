import React from 'react';

interface FormInputProps {
  label: string;
  value: any;
  onChange: (value: any) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'select' | 'checkbox';
  options?: { label: string; value: string }[];
  className?: string;
}

export const FormInput = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  options,
  className = ''
}: FormInputProps) => {
  const commonClass = "w-full p-2 rounded border bg-background text-sm";

  return (
    <div className={className}>
      <label className="block text-xs font-medium mb-1">{label}</label>
      {type === 'select' ? (
        <select
          className={commonClass}
          value={value}
          onChange={e => onChange(e.target.value)}
        >
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

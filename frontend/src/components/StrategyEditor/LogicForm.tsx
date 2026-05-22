import React, { useState, useEffect } from 'react';

interface LogicFormProps {
  initialValues: any;
  onSave: (values: any) => Promise<void>;
}

export const LogicForm: React.FC<LogicFormProps> = ({ initialValues, onSave }) => {
  const [values, setValues] = useState<any>(initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setValues(initialValues);
    setIsDirty(false);
  }, [initialValues]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleChange = (path: string[], value: any) => {
    const newValues = { ...values };
    let current = newValues;
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]] = { ...current[path[i]] };
    }
    current[path[path.length - 1]] = value;
    setValues(newValues);
    setIsDirty(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(values);
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to save logic settings:', error);
      alert('Error saving logic settings');
    } finally {
      setIsSaving(false);
    }
  };

  const renderInput = (key: string, value: any, path: string[]) => {
    const type = typeof value;

    if (type === 'boolean') {
      return (
        <div className="flex items-center justify-between p-2 rounded hover:bg-slate-800/50 transition-colors">
          <label className="text-sm text-slate-400 capitalize">{key.replace(/_/g, ' ')}</label>
          <button
            onClick={() => handleChange(path, !value)}
            className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${value ? 'bg-blue-600' : 'bg-slate-700'}`}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      );
    }

    if (type === 'number') {
      return (
        <div className="flex flex-col gap-1 p-2 rounded hover:bg-slate-800/50 transition-colors">
          <label className="text-sm text-slate-400 capitalize">{key.replace(/_/g, ' ')}</label>
          <input
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => handleChange(path, parseFloat(e.target.value))}
            className="bg-slate-950 border border-slate-800 text-slate-100 px-3 py-1 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1 p-2 rounded hover:bg-slate-800/50 transition-colors">
        <label className="text-sm text-slate-400 capitalize">{key.replace(/_/g, ' ')}</label>
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(path, e.target.value)}
          className="bg-slate-950 border border-slate-800 text-slate-100 px-3 py-1 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
      </div>
    );
  };

  const renderRecursive = (obj: any, path: string[] = []) => {
    if (typeof obj !== 'object' || obj === null) return null;

    return Object.entries(obj).map(([key, value]) => {
      const currentPath = [...path, key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const isExpanded = expandedSections[key] || path.length === 0;
        return (
          <div key={key} className="mb-4 border border-slate-800 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection(key)}
              className="w-full flex items-center justify-between p-3 bg-slate-800/30 hover:bg-slate-800/50 transition-colors text-slate-200 font-medium"
            >
              <span className="capitalize">{key.replace(/_/g, ' ')}</span>
              <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {isExpanded && (
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-900/50">
                {renderRecursive(value, currentPath)}
              </div>
            )}
          </div>
        );
      }
      return renderInput(key, value, currentPath);
    });
  };

  return (
    <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-semibold text-slate-100">Strategy Logic</h3>
        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            !isDirty || isSaving
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95'
          }`}
        >
          {isSaving ? 'Saving...' : 'Save Logic Settings'}
        </button>
      </div>
      <div className="space-y-4">
        {renderRecursive(values)}
      </div>
    </div>
  );
};

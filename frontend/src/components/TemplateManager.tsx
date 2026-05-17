import React, { useEffect, useState } from 'react';
import { templateApi, type Template, type TemplateType } from '../lib/api';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from './ui/components';
import { cn } from '../lib/utils';

export const TemplateManager = () => {
  const [type, setType] = useState<TemplateType>('logic');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Editor State
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [editingConfig, setEditingConfig] = useState<string>('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await templateApi.getTemplates();
      setTemplates(res.data[type]);
    } catch (err) {
      console.error('Failed to fetch templates', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, [type]);

  const handleCreate = async () => {
    if (!newTemplateName.trim()) return;
    try {
      await templateApi.createTemplate(type, {
        name: newTemplateName,
        config: {},
      });
      setNewTemplateName('');
      setIsCreateOpen(false);
      await fetchTemplates();
    } catch (err) {
      alert('Failed to create template: ' + (err as any).message);
    }
  };

  const handleSelectTemplate = async (template: Template) => {
    setEditorLoading(true);
    try {
      const res = await templateApi.getTemplate(type, template.id);
      const data = res.data;
      setSelectedTemplate(data);
      setEditingConfig(JSON.stringify(data.config, null, 2));
      setIsLocked((data as any).isLocked || false);
    } catch (err) {
      alert('Failed to load template: ' + (err as any).message);
    } finally {
      setEditorLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;
    try {
      const config = JSON.parse(editingConfig);
      await templateApi.updateTemplate(type, selectedTemplate.id, { config });
      alert('Template saved successfully!');
    } catch (err: any) {
      if (err.response?.status === 403) {
        alert('Error: This template is locked and cannot be modified.');
      } else if (err instanceof SyntaxError) {
        alert('Invalid JSON: ' + err.message);
      } else {
        alert('Failed to save template: ' + (err.message || 'Unknown error'));
      }
    }
  };

  const handleDuplicate = async () => {
    if (!selectedTemplate) return;
    const newName = prompt('Enter name for duplicated template:', `${selectedTemplate.name} Copy`);
    if (!newName) return;
    try {
      await templateApi.duplicateTemplate(type, selectedTemplate.id, newName);
      alert('Template duplicated successfully!');
      await fetchTemplates();
    } catch (err: any) {
      alert('Failed to duplicate template: ' + err.message);
    }
  };

  const handleDelete = async () => {
    if (!selectedTemplate) return;
    if (!confirm(`Are you sure you want to delete template "${selectedTemplate.name}"?`)) return;
    try {
      await templateApi.deleteTemplate(type, selectedTemplate.id);
      setSelectedTemplate(null);
      setEditingConfig('');
      setIsLocked(false);
      await fetchTemplates();
      alert('Template deleted successfully!');
    } catch (err: any) {
      alert('Failed to delete template: ' + err.message);
    }
  };

  useEffect(() => {
    if (editingConfig) {
      try {
        JSON.parse(editingConfig);
        setJsonError(null);
      } catch (e: any) {
        setJsonError(e.message);
      }
    }
  }, [editingConfig]);

  const filteredTemplates = templates.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-full gap-4">
      {/* Sidebar / Master List */}
      <Card className="w-80 flex flex-col h-[calc(100vh-120px)]">
        <CardHeader className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <CardTitle className="text-lg">Templates</CardTitle>
            <Button
              onClick={() => setIsCreateOpen(true)}
              variant="primary"
              className="text-xs h-8 px-2"
            >
              + New
            </Button>
          </div>

          <div className="flex bg-muted p-1 rounded-lg gap-1 mb-4">
            <Button
              onClick={() => { setType('logic'); setSelectedTemplate(null); }}
              variant={type === 'logic' ? 'primary' : 'ghost'}
              className="text-xs px-3 h-7 flex-1"
            >
              Logic
            </Button>
            <Button
              onClick={() => { setType('risk'); setSelectedTemplate(null); }}
              variant={type === 'risk' ? 'primary' : 'ghost'}
              className="text-xs px-3 h-7 flex-1"
            >
              Risk
            </Button>
          </div>

          <input
            className="w-full p-2 text-xs rounded border bg-background"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-2 space-y-2">
          {loading ? (
            <div className="text-center p-4 text-muted-foreground text-xs">Loading...</div>
          ) : filteredTemplates.length === 0 ? (
            <div className="text-center p-4 text-muted-foreground text-xs">No templates found.</div>
          ) : (
            filteredTemplates.map(t => (
              <div
                key={t.id}
                onClick={() => handleSelectTemplate(t)}
                className={cn(
                  "p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors group",
                  selectedTemplate?.id === t.id && "border-primary bg-primary/5 ring-1 ring-primary"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate">{t.name}</span>
                  <span className="text-xs">
                    {(t as any).isLocked ? '🔒' : '✅'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {(t as any).usedBy?.length || 0} strategies
                  </Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Editor Area */}
      <Card className="flex-1 h-[calc(100vh-120px)] flex flex-col">
        <CardHeader className="p-4 border-b flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">
            {selectedTemplate ? selectedTemplate.name : 'Template Editor'}
          </CardTitle>
          <div className="flex gap-2">
            {selectedTemplate && (
              <>
                <Button onClick={handleDuplicate} variant="outline" className="text-xs h-8">Duplicate</Button>
                <Button onClick={handleDelete} variant="ghost" className="text-xs h-8 text-destructive hover:text-destructive">Delete</Button>
                <Button
                  onClick={handleSave}
                  variant="primary"
                  className="text-xs h-8"
                  disabled={isLocked || editorLoading}
                >
                  Save Changes
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
          {selectedTemplate ? (
            <>
              {isLocked && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg flex items-center gap-2">
                  <span>🔒</span>
                  <span><strong>Template Locked:</strong> This template is a system default and cannot be modified. Duplicate it to create a custom version.</span>
                </div>
              )}

              <div className="flex-1 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Configuration JSON</label>
                  <span className={cn(
                    "text-xs font-medium",
                    jsonError ? "text-destructive" : "text-green-600"
                  )}>
                    {jsonError ? `❌ Invalid JSON: ${jsonError}` : "✅ Valid JSON"}
                  </span>
                </div>
                <textarea
                  className="flex-1 w-full p-3 font-mono text-xs rounded border bg-background resize-none focus:ring-1 focus:ring-primary outline-none"
                  value={editingConfig}
                  onChange={e => setEditingConfig(e.target.value)}
                  disabled={isLocked}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground italic">
              {editorLoading ? "Loading template..." : "Select a template from the list to edit its configuration"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 shadow-2xl">
            <CardTitle className="text-xl mb-4">Create {type} Template</CardTitle>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Template Name</label>
                <input
                  autoFocus
                  className="w-full p-2 rounded border bg-background"
                  value={newTemplateName}
                  onChange={e => setNewTemplateName(e.target.value)}
                  placeholder="e.g. Aggressive Scalping"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button onClick={() => setIsCreateOpen(false)} variant="outline">Cancel</Button>
                <Button onClick={handleCreate}>Create</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

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
              onClick={() => setType('logic')}
              variant={type === 'logic' ? 'primary' : 'ghost'}
              className="text-xs px-3 h-7 flex-1"
            >
              Logic
            </Button>
            <Button
              onClick={() => setType('risk')}
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
                className="p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors group"
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
        <CardHeader className="p-4 border-b">
          <CardTitle className="text-lg">Template Editor</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center text-muted-foreground italic">
          Select a template from the list to edit its configuration
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

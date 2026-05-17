import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Strategy {
  id: number;
  name: string;
  config: string;
  status: 'running' | 'stopped';
  last_run: string;
}

export interface Template {
  id: string;
  name: string;
  config: any;
}

export interface TemplatesResponse {
  logic: Template[];
  risk: Template[];
}

export type TemplateType = 'logic' | 'risk';

export const strategyApi = {
  getStrategies: (archived = false) => api.get<Strategy[]>(`/strategies?archived=${archived}`),
  createStrategy: (data: { name: string; logicTemplateId: string; riskTemplateId: string; settings?: any }) => api.post('/strategies', data),
  toggleStrategy: (strategyId: number) => api.post('/strategies/toggle', { strategyId }),
  updateConfig: (strategyId: number, data: { name?: string; logicTemplateId: string; riskTemplateId: string; settings?: any }) => api.post('/strategies/config', { strategyId, ...data }),
  archiveStrategy: (id: number) => api.post('/strategies/archive', { strategyId: id }),
  restoreStrategy: (id: number) => api.post('/strategies/restore', { strategyId: id }),
  deleteStrategyPermanently: (id: number) => api.delete(`/strategies/${id}`),
  getLeaderboard: () => api.get('/analytics/leaderboard'),
  getSummary: () => api.get('/analytics/summary'),
  exportTrades: (strategyId: number) => api.get(`/export/${strategyId}`, { responseType: 'blob' }),
};

export const templateApi = {
  getTemplates: () => api.get<TemplatesResponse>('/templates'),
  getTemplate: (type: TemplateType, id: string) => api.get<Template>(`/templates/${type}/${id}`),
  createTemplate: (type: TemplateType, data: Partial<Template>) => api.post(`/templates/${type}`, data),
  updateTemplate: (type: TemplateType, id: string, data: Partial<Template>) => api.put(`/templates/${type}/${id}`, data),
  deleteTemplate: (type: TemplateType, id: string) => api.delete(`/templates/${type}/${id}`),
  duplicateTemplate: (type: TemplateType, id: string, newName: string) => api.post(`/templates/${type}/${id}/duplicate`, { newName }),
};

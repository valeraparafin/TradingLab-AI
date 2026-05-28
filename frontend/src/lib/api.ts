import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

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

export interface LogicTemplate {
  id: string;
  name: string;
  type: string;
  indicators: Record<string, any>;
  safety_checks?: Array<{ id: string; description: string }>;
}

export interface RiskTemplate {
  id: string;
  name: string;
  settings: {
    riskPerTradePercent: number;
    maxTradeSizeUSD: number;
    stopLossPercent: number;
    takeProfitPercent: number;
    maxTradesPerDay: number;
  };
}

export type Template = LogicTemplate | RiskTemplate;

export interface TemplatesResponse {
  logic: Template[];
  risk: Template[];
}

export type TemplateType = 'logic' | 'risk';

export interface XaiState {
  symbol: string;
  gci: number;
  results: Array<{ label: string; score: number; actual: any }>;
  [key: string]: any;
}

export type XaiMap = Record<string, XaiState>;

export interface AssetPrecision {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
}

export const strategyApi = {
  getStrategies: (archived = false) => api.get<Strategy[]>(`/strategies?archived=${archived}`),
  createStrategy: (data: { name: string; logicTemplateId: string; riskTemplateId: string; settings?: any }) => api.post('/strategies', data),
  toggleStrategy: (strategyId: number) => api.post('/strategies/toggle', { strategyId }),
  updateConfig: (strategyId: number, data: { name?: string; logicTemplateId?: string; riskTemplateId?: string; settings?: any }) => api.post('/strategies/config', { strategyId, ...data }),
  archiveStrategy: (id: number) => api.post('/strategies/archive', { strategyId: id }),
  restoreStrategy: (id: number) => api.post('/strategies/restore', { strategyId: id }),
  deleteStrategyPermanently: (id: number) => api.delete(`/strategies/${id}`),
  getLeaderboard: () => api.get('/analytics/leaderboard'),
  getSummary: () => api.get('/analytics/summary'),
  exportTrades: (strategyId: number) => api.get(`/export/${strategyId}`, { responseType: 'blob' }),
  getStats: (id: number) => api.get(`/strategies/stats/${id}`),
  getPositions: (id: number) => api.get(`/strategies/positions/${id}`),
  getEvents: (strategyId: number, limit: number = 100) => api.get(`/strategies/events/${strategyId}?limit=${limit}`),
  // getPrecision: (symbol: string) => api.get<{ precision: number }>(`/precision?symbol=${symbol}`),
  getLatestXai: (id: number) => api.get<XaiMap | XaiState | null>(`/strategies/xai/${id}`),
};

export const templateApi = {
  getTemplates: async () => {
    const res = await api.get<TemplatesResponse>('/templates');
    return res.data;
  },
  getTemplate: async (type: TemplateType, id: string) => {
    const res = await api.get<Template>(`/templates/${type}/${id}`);
    return res.data;
  },
  createTemplate: async (type: TemplateType, data: Partial<Template>) => {
    const res = await api.post(`/templates/${type}`, data);
    return res.data;
  },
  updateTemplate: async (type: TemplateType, id: string, newName: string) => {
    const res = await api.put(`/templates/${type}/${id}`, { newName });
    return res.data;
  },
  duplicateTemplate: async (type: TemplateType, id: string, newName: string) => {
    const res = await api.post(`/templates/${type}/${id}`, { newName });
    return res.data;
  },
};

export const assetApi = {
  getAssets: () => api.get<AssetPrecision[]>('/assets'),
  syncAssets: () => api.post('/assets/sync'),
};

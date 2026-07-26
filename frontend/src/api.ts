import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

export interface SandboxContainer {
  id: string;
  name: string;
  templateKey: string;
  image: string;
  status: 'creating' | 'running' | 'stopped' | 'error' | 'destroyed';
  cpuLimit: number;
  memoryLimitMb: number;
  hostPort: number | null;
  url: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export interface Template {
  key: string;
  label: string;
  image: string;
  description: string;
  exposed_port: number | null;
}

export const ContainerApi = {
  list: () => api.get<SandboxContainer[]>('/containers'),
  get: (id: string) => api.get<SandboxContainer>(`/containers/${id}`),
  create: (templateKey: string, name?: string) => api.post('/containers', { templateKey, name }),
  start: (id: string) => api.post(`/containers/${id}/start`),
  stop: (id: string) => api.post(`/containers/${id}/stop`),
  restart: (id: string) => api.post(`/containers/${id}/restart`),
  snapshot: (id: string) => api.post(`/containers/${id}/snapshot`),
  remove: (id: string, keepData = false) => api.delete(`/containers/${id}?keepData=${keepData}`),
  stats: (id: string) => api.get(`/containers/${id}/stats`),
  metricsHistory: (id: string) => api.get(`/containers/${id}/metrics-history`),
};

export const TemplateApi = {
  list: () => api.get<Template[]>('/templates'),
};

export interface FileEntry { name: string; isDir: boolean; size: number; modifiedAt: number | null; }

export const FileApi = {
  list: (containerId: string, path = '/') => api.get(`/containers/${containerId}/files`, { params: { path } }),
  mkdir: (containerId: string, path: string, name: string) => api.post(`/containers/${containerId}/files/mkdir`, { path, name }),
  remove: (containerId: string, path: string) => api.delete(`/containers/${containerId}/files`, { params: { path } }),
  downloadUrl: (containerId: string, path: string) =>
    `/api/containers/${containerId}/files/download?path=${encodeURIComponent(path)}`,
  upload: (containerId: string, path: string, file: File) => {
    const form = new FormData();
    form.append('path', path);
    form.append('file', file);
    return api.post(`/containers/${containerId}/files/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

export interface CompilerLanguage { key: string; label: string; starter: string; }
export interface CompileResult { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number; }

export const CompilerApi = {
  languages: () => api.get<CompilerLanguage[]>('/compiler/languages'),
  run: (language: string, code: string, stdin?: string) =>
    api.post<CompileResult>('/compiler/run', { language, code, stdin }),
};

export function wsUrl(kind: 'exec' | 'stats', containerId: string) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/${kind}/${containerId}`;
}

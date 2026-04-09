import type { Config } from '../config/schema.js';
import { requestJson } from './http.js';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
}

export function getHealth(config: Config): Promise<HealthResponse> {
  return requestJson<HealthResponse>(config, { path: 'health' });
}

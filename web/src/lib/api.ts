import type { Catalog, SuggestionRequest, SuggestionResponse } from '@shared/types';

const TIMEOUT_MS = 4000;

export class ApiOffline extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiOffline';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        if (body?.message) detail = String(body.message);
      } catch {
        /* non-JSON error body */
      }
      throw new ApiOffline(detail);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiOffline) throw error;
    throw new ApiOffline(
      error instanceof DOMException && error.name === 'AbortError'
        ? 'request timed out'
        : 'backend unreachable',
    );
  } finally {
    clearTimeout(timer);
  }
}

export function getHealth(): Promise<{ status: string; version: string; db: string }> {
  return request('/health');
}

export function getCatalog(): Promise<Catalog> {
  return request('/catalog');
}

export function postSuggestions(body: SuggestionRequest): Promise<SuggestionResponse> {
  return request('/suggestions', { method: 'POST', body: JSON.stringify(body) });
}

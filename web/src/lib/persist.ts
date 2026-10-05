import type { Project } from '@shared/types';

/**
 * Local persistence for the working project and the reviewer's display name.
 *
 * Storage can be missing, full, or throw on access (private windows, blocked
 * site data, sandboxed previews), so every call is wrapped and failure simply
 * means "nothing remembered" — the studio never depends on it.
 */
const PROJECT_KEY = 'dezine.project.v1';
const AUTHOR_KEY = 'dezine.author';

export interface SavedProject {
  project: Project;
  savedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadSavedProject(): SavedProject | null {
  try {
    const raw = storage()?.getItem(PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedProject;
    const floor = parsed?.project?.floors?.[0];
    if (!floor || !Array.isArray(floor.walls) || !Array.isArray(floor.rooms)) return null;
    return parsed;
  } catch {
    return null;
  }
}

let pending: number | null = null;
let latest: Project | null = null;

/** Debounced: a corner drag commits every frame, storage should not. */
export function saveProject(project: Project) {
  latest = project;
  if (pending !== null) return;
  pending = window.setTimeout(flushProject, 400);
}

export function flushProject() {
  if (pending !== null) window.clearTimeout(pending);
  pending = null;
  if (!latest) return;
  try {
    storage()?.setItem(
      PROJECT_KEY,
      JSON.stringify({ project: latest, savedAt: new Date().toISOString() } satisfies SavedProject),
    );
  } catch {
    /* quota or blocked storage — the session just is not remembered */
  }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushProject);

export function loadAuthor(): string {
  try {
    return storage()?.getItem(AUTHOR_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveAuthor(name: string) {
  try {
    storage()?.setItem(AUTHOR_KEY, name);
  } catch {
    /* not remembered; asked again next session */
  }
}

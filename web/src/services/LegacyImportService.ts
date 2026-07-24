import { projectRepository } from './ProjectRepository';
import { fileRepository } from './FileRepository';
import { settingsService } from './SettingsService';

const LEGACY_IMPORTED_KEY = 'legacyImportCompleted';
const LEGACY_DB_NAME = 'zhangl-examtutor';
const LEGACY_ACTIVE_PROJECT_KEY = 'zhangl-active-project';

interface LegacyProject {
  name: string;
  config?: Record<string, unknown>;
  created?: string;
  modified?: string;
}

interface LegacyFile {
  project: string;
  path: string;
  content: string;
}

function openLegacyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }

    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([]);
      return;
    }
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result || []) as T[]);
    request.onerror = () => resolve([]);
  });
}

function asDateMs(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
}

export class LegacyImportService {
  async ensureImported(): Promise<void> {
    const done = await settingsService.get<boolean>(LEGACY_IMPORTED_KEY, false);
    if (done) return;

    const db = await openLegacyDb();
    if (!db) {
      await projectRepository.getActiveProject();
      await settingsService.set(LEGACY_IMPORTED_KEY, true);
      return;
    }

    const [legacyProjects, legacyFiles] = await Promise.all([
      getAll<LegacyProject>(db, 'projects'),
      getAll<LegacyFile>(db, 'files')
    ]);
    db.close();

    const names = new Set<string>();
    legacyProjects.forEach((project) => {
      if (project.name) names.add(project.name);
    });
    legacyFiles.forEach((file) => {
      if (file.project) names.add(file.project);
    });

    const now = Date.now();
    const projectByName = new Map<string, Awaited<ReturnType<typeof projectRepository.createProject>>>();
    for (const name of names) {
      const legacy = legacyProjects.find((project) => project.name === name);
      const config = legacy?.config || {};
      const project = await projectRepository.createProject({
        name,
        examDate: String(config.exam_date || ''),
        examType: String(config.exam_type || ''),
        province: String(config.province || ''),
        mockExamCount: Number(config.mock_exam_count || 120),
        position: String(config.position || ''),
        requirements: String(config.requirements || '')
      });
      project.createdAt = asDateMs(legacy?.created, now);
      project.updatedAt = asDateMs(legacy?.modified, now);
      projectByName.set(name, project);
    }

    for (const file of legacyFiles) {
      const project = projectByName.get(file.project);
      if (!project || !file.path) continue;
      await fileRepository.writeText(project.id, file.path, file.content || '');
    }

    const activeName = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_ACTIVE_PROJECT_KEY) : null;
    if (activeName) {
      const active = projectByName.get(activeName);
      if (active) await projectRepository.setActiveProject(active.id);
    } else {
      await projectRepository.getActiveProject();
    }

    await settingsService.set(LEGACY_IMPORTED_KEY, true);
  }
}

export const legacyImportService = new LegacyImportService();

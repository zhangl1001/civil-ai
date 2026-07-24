import { defineStore } from 'pinia';
import type { LocalTask } from '@/domain/task';
import { projectRepository } from '@/services/ProjectRepository';
import { taskInputHash } from '@/tasks/TaskLocks';
import { taskQueue } from '@/tasks/TaskQueue';
import { TASK_CHANGED_EVENT, taskStore } from '@/tasks/TaskStore';
import { isActiveStatus, taskSortRank } from '@/tasks/TaskPresenter';

export interface TaskUiState {
  tasks: LocalTask[];
  isLoading: boolean;
  initialized: boolean;
  readTaskIds: string[];
  hiddenTaskIds: string[];
}

export const useTasksStore = defineStore('tasks', {
  state: (): TaskUiState => ({
    tasks: [],
    isLoading: false,
    initialized: false,
    readTaskIds: readStoredIds('task-read-ids'),
    hiddenTaskIds: readStoredIds('task-hidden-ids')
  }),

  getters: {
    activeTasks(state): LocalTask[] {
      return state.tasks.filter((task) => isActiveStatus(task.status));
    },
    visibleTasks(state): LocalTask[] {
      const hidden = new Set(state.hiddenTaskIds);
      return [...state.tasks]
        .filter((task) => isActiveStatus(task.status) || !hidden.has(task.id))
        .sort((a, b) => taskSortRank(a) - taskSortRank(b) || b.updatedAt - a.updatedAt)
        .slice(0, 6);
    },
    latestTask(state): LocalTask | undefined {
      return [...state.tasks].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    }
  },

  actions: {
    async init() {
      if (this.initialized) return;
      this.initialized = true;
      await this.refresh();
      window.addEventListener(TASK_CHANGED_EVENT, () => {
        void this.refresh();
      });
    },

    async refresh() {
      this.isLoading = true;
      try {
        const project = await projectRepository.getActiveProject();
        this.tasks = await taskStore.list(project.id);
        this.pruneLocalState();
      } finally {
        this.isLoading = false;
      }
    },

    unreadCount(): number {
      const read = new Set(this.readTaskIds);
      return this.visibleTasks.filter((task) => !isActiveStatus(task.status) && !read.has(task.id)).length;
    },

    markVisibleRead() {
      const next = new Set(this.readTaskIds);
      this.visibleTasks.forEach((task) => {
        if (!isActiveStatus(task.status)) next.add(task.id);
      });
      this.readTaskIds = [...next];
      writeStoredIds('task-read-ids', this.readTaskIds);
    },

    hideTask(taskId: string) {
      const task = this.tasks.find((item) => item.id === taskId);
      if (!task || isActiveStatus(task.status)) return;
      this.hiddenTaskIds = [...new Set([...this.hiddenTaskIds, taskId])];
      this.readTaskIds = [...new Set([...this.readTaskIds, taskId])];
      writeStoredIds('task-hidden-ids', this.hiddenTaskIds);
      writeStoredIds('task-read-ids', this.readTaskIds);
    },

    clearCompleted() {
      const completed = this.tasks.filter((task) => !isActiveStatus(task.status)).map((task) => task.id);
      if (!completed.length) return;
      this.hiddenTaskIds = [...new Set([...this.hiddenTaskIds, ...completed])];
      this.readTaskIds = [...new Set([...this.readTaskIds, ...completed])];
      writeStoredIds('task-hidden-ids', this.hiddenTaskIds);
      writeStoredIds('task-read-ids', this.readTaskIds);
    },

    pruneLocalState() {
      const ids = new Set(this.tasks.map((task) => task.id));
      const read = this.readTaskIds.filter((id) => ids.has(id)).slice(-80);
      const hidden = this.hiddenTaskIds.filter((id) => ids.has(id)).slice(-80);
      if (read.length !== this.readTaskIds.length) {
        this.readTaskIds = read;
        writeStoredIds('task-read-ids', read);
      }
      if (hidden.length !== this.hiddenTaskIds.length) {
        this.hiddenTaskIds = hidden;
        writeStoredIds('task-hidden-ids', hidden);
      }
    },

    async cancel(taskId: string) {
      await taskQueue.cancel(taskId);
      await this.refresh();
    },

    async enqueueDemoTask() {
      const project = await projectRepository.getActiveProject();
      await taskQueue.enqueue({
        type: 'demo',
        projectId: project.id,
        title: '测试任务',
        detail: '验证任务栏动效和状态',
        inputHash: taskInputHash({ type: 'demo', at: Date.now() }),
        lockKey: `demo:${project.id}`
      });
      await this.refresh();
    }
  }
});

function readStoredIds(key: string): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStoredIds(key: string, ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(ids.slice(-80)));
}

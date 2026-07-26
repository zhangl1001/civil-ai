import { projectRepository } from './ProjectRepository';
import type { GenerationIntent } from './GenerationTaskService';

const PROFILE_REQUIRED_INTENTS: ReadonlySet<GenerationIntent> = new Set([
  'practice',
  'mock',
  'redo',
  'essayGrade',
  'interviewReview'
]);

export class ProfileRequiredError extends Error {
  constructor(message = '请先建立备考档案，再开始目标驱动训练。') {
    super(message);
    this.name = 'ProfileRequiredError';
  }
}

export class ProfileGuardService {
  needsProfile(intent: GenerationIntent): boolean {
    return PROFILE_REQUIRED_INTENTS.has(intent);
  }

  async ensureActiveProfile(intent: GenerationIntent): Promise<void> {
    if (!this.needsProfile(intent)) return;
    await projectRepository.getActiveProject().catch(() => {
      throw new ProfileRequiredError('当前还没有完整备考档案，请先补全目标、现状和学习时间。');
    });
  }
}

export const profileGuardService = new ProfileGuardService();

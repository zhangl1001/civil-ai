import { appLifecycleAdapter } from '@/platform/AppLifecycleAdapter';
import { installWebViewRepaintGuard } from '@/platform/WebViewRepaintGuard';
import { statusBarAdapter } from '@/platform/StatusBarAdapter';
import { themeService } from './ThemeService';
import { initializeTutorRuntime } from '@/composition-root/public';
import { agentWorkerCoordinator } from '@/composition-root/agent/AgentWorkerCoordinator';
import { proactiveTutorCoordinator } from '@/composition-root/proactive/ProactiveTutorCoordinator';
import { objectiveSubmissionRecoveryCoordinator } from '@/composition-root/evidence/ObjectiveSubmissionRecoveryCoordinator';
import { tutorDatabaseLifecycleCoordinator } from '@/composition-root/database/TutorDatabaseLifecycleCoordinator';
import { projectRepository } from './ProjectRepository';

export async function bootstrapLocalApp(): Promise<void> {
  projectRepository.bindCurrentProject(async () => {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) return undefined;
    return {
      id: cycle.project.id,
      name: cycle.project.name,
      status: 'active',
      activeProfileId: cycle.profile.id,
      createdAt: cycle.project.createdAt,
      updatedAt: cycle.project.updatedAt
    };
  });
  appLifecycleAdapter.init();
  statusBarAdapter.init();
  installWebViewRepaintGuard();
  const runtime = await initializeTutorRuntime();
  tutorDatabaseLifecycleCoordinator.install(runtime);
  agentWorkerCoordinator.install(runtime);
  objectiveSubmissionRecoveryCoordinator.install(runtime);
  proactiveTutorCoordinator.install(runtime);
  await themeService.initialize();
}

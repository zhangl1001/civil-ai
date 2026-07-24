import { initLocalDatabase } from '@/db/migrations';
import { appLifecycleAdapter } from '@/platform/AppLifecycleAdapter';
import { installWebViewRepaintGuard } from '@/platform/WebViewRepaintGuard';
import { statusBarAdapter } from '@/platform/StatusBarAdapter';
import { bootstrapTasks } from '@/tasks/TaskBootstrap';
import { legacyImportService } from './LegacyImportService';
import { themeService } from './ThemeService';
import { initializeTutorRuntime } from '@/composition-root/public';

export async function bootstrapLocalApp(): Promise<void> {
  appLifecycleAdapter.init();
  statusBarAdapter.init();
  installWebViewRepaintGuard();
  await initLocalDatabase();
  await initializeTutorRuntime();
  await themeService.initialize();
  await legacyImportService.ensureImported();
  await bootstrapTasks();
}

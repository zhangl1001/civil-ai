import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { bootstrapLocalApp } from './services/AppBootstrap';
import { capacitorRuntime, installNativePlatformClass } from './platform/capacitor';
import { probeNativeStreamingHttp } from './platform/NativeStreamingHttpAdapter';
import { installDatabaseStallRecovery } from './platform/DatabaseStallRecovery';
import { installCurriculumLabels } from './domain/labels';
import { installChoiceGradingRule } from './domain/choiceGradingRules';
import { installWrittenFormats } from './domain/writtenFormats';
import { createBundledCurriculumPacks, projectExamSubjects } from './modules/curriculum/public';

// Global styles
import './assets/styles/design-tokens.css';
import './assets/styles/main.css';
import 'katex/dist/katex.min.css';

installNativePlatformClass();
installDatabaseStallRecovery();

// Names come from the exam package, not from application code. The first
// bundled pack is a static import, so the UI has labels before the first
// render; the runtime swaps in the candidate's own pack once it resolves.
const [defaultExamPack] = createBundledCurriculumPacks();
if (defaultExamPack) {
  const defaultSubjects = projectExamSubjects(defaultExamPack.bundle);
  installCurriculumLabels(defaultExamPack.bundle.capabilityNodes);
  installWrittenFormats(defaultSubjects);
  installChoiceGradingRule(defaultSubjects);
}

void probeNativeStreamingHttp().then((available) => {
  if (available) console.info('[AITransport] Native streaming transport is ready.');
});

bootstrapLocalApp().catch((error) => {
  console.warn('[bootstrapLocalApp]', error);
});

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.mount('#app');

function openNotificationRoute(route: string | null | undefined) {
  if (!route) return;
  const normalized = route.startsWith('#') ? route.slice(1) : route;
  void router.push(normalized || '/');
}

window.addEventListener('study-notification-open', (event) => {
  openNotificationRoute((event as CustomEvent<string>).detail);
});

router.isReady().then(async () => {
  const notificationPlugin = capacitorRuntime()?.Plugins?.LearningNotifications;
  const pending = await notificationPlugin?.consumePendingRoute?.();
  openNotificationRoute(pending?.route);
}).catch((error) => {
  console.warn('[notification route]', error);
});

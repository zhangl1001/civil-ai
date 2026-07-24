import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { bootstrapLocalApp } from './services/AppBootstrap';
import { capacitorRuntime, installNativePlatformClass } from './platform/capacitor';

// Global styles
import './assets/styles/design-tokens.css';
import './assets/styles/main.css';

installNativePlatformClass();

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

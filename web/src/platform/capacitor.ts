export interface CapacitorAppPlugin {
  addListener?: (
    eventName: 'appStateChange',
    listenerFunc: (state: { isActive: boolean }) => void
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
}

export interface KeychainPlugin {
  get(input: { key: string }): Promise<{ value: string | null }>;
  set(input: { key: string; value: string }): Promise<void>;
  remove(input: { key: string }): Promise<void>;
}

export interface LearningNotificationItem {
  id: string;
  title: string;
  body: string;
  at: string;
  route: string;
}

export interface LearningNotificationsPlugin {
  requestPermission(): Promise<{ granted: boolean }>;
  schedule(input: { items: LearningNotificationItem[] }): Promise<{ scheduled: number }>;
  getStatus(): Promise<{ native: boolean; authorization: string; pending: number }>;
  clearAll(): Promise<void>;
  consumePendingRoute(): Promise<{ route: string | null }>;
}

export interface StatusBarPlugin {
  setStyle(input: { style: 'LIGHT' | 'DARK' | 'DEFAULT' }): Promise<void>;
}

export interface CapacitorRuntime {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: {
    App?: CapacitorAppPlugin;
    Keychain?: KeychainPlugin;
    LearningNotifications?: LearningNotificationsPlugin;
    StatusBar?: StatusBarPlugin;
  };
}

declare global {
  interface Window {
    Capacitor?: CapacitorRuntime;
  }
}

export function capacitorRuntime(): CapacitorRuntime | undefined {
  return window.Capacitor;
}

export function installNativePlatformClass(): void {
  const runtime = capacitorRuntime();
  const isNativeIOS = runtime?.getPlatform?.() === 'ios' && runtime?.isNativePlatform?.() !== false;
  document.documentElement.classList.toggle('native-ios', isNativeIOS);
}

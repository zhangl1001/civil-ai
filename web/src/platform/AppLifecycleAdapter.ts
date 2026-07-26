import { capacitorRuntime } from './capacitor';

export type AppLifecycleState = 'active' | 'inactive' | 'background';
export type AppLifecycleReason =
  | 'focus'
  | 'visibility'
  | 'native-resume'
  | 'app-active'
  | 'app-will-resign-active'
  | 'app-did-enter-background'
  | 'app-will-enter-foreground'
  | 'app-did-become-active'
  | 'capacitor-app-state'
  | 'pageshow';

export interface AppLifecycleEvent {
  state: AppLifecycleState;
  reason: AppLifecycleReason;
  at: number;
}

type Listener = (event: AppLifecycleEvent) => void;

export class AppLifecycleAdapter {
  private initialized = false;
  private activeListeners = new Set<Listener>();
  private changeListeners = new Set<Listener>();
  private lastEvent: AppLifecycleEvent = {
    state: document.hidden ? 'background' : 'active',
    reason: 'visibility',
    at: Date.now()
  };

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    window.addEventListener('focus', () => this.emit('active', 'focus'));
    window.addEventListener('pageshow', () => this.emit('active', 'pageshow'));
    window.addEventListener('native-resume', () => this.emit('active', 'native-resume'));
    window.addEventListener('app-active', () => this.emit('active', 'app-active'));
    window.addEventListener('app-will-resign-active', () => this.emit('inactive', 'app-will-resign-active'));
    window.addEventListener('app-did-enter-background', () => this.emit('background', 'app-did-enter-background'));
    window.addEventListener('app-will-enter-foreground', () => this.emit('inactive', 'app-will-enter-foreground'));
    window.addEventListener('app-did-become-active', () => this.emit('active', 'app-did-become-active'));

    document.addEventListener('visibilitychange', () => {
      this.emit(document.hidden ? 'background' : 'active', 'visibility');
    });

    const appPlugin = capacitorRuntime()?.Plugins?.App;
    try {
      void appPlugin?.addListener?.('appStateChange', (state) => {
        this.emit(state.isActive ? 'active' : 'background', 'capacitor-app-state');
      });
    } catch (error) {
      console.warn('[AppLifecycleAdapter] Capacitor App listener unavailable', error);
    }
  }

  onActive(listener: Listener): () => void {
    this.activeListeners.add(listener);
    return () => this.activeListeners.delete(listener);
  }

  onChange(listener: Listener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  current(): AppLifecycleEvent {
    return this.lastEvent;
  }

  private emit(state: AppLifecycleState, reason: AppLifecycleReason): void {
    const event: AppLifecycleEvent = { state, reason, at: Date.now() };
    this.lastEvent = event;
    window.dispatchEvent(new CustomEvent('zhangl-app-lifecycle', { detail: event }));
    this.changeListeners.forEach((listener) => listener(event));
    if (state !== 'active') return;
    this.activeListeners.forEach((listener) => listener(event));
    window.dispatchEvent(new CustomEvent('zhangl-app-active', { detail: event }));
  }
}

export const appLifecycleAdapter = new AppLifecycleAdapter();

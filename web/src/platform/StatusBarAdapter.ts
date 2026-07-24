import { appLifecycleAdapter } from './AppLifecycleAdapter';
import { capacitorRuntime } from './capacitor';

export class StatusBarAdapter {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    void this.applyLightBackgroundStyle();
    appLifecycleAdapter.onActive(() => {
      void this.applyLightBackgroundStyle();
    });
  }

  private async applyLightBackgroundStyle(): Promise<void> {
    const statusBar = capacitorRuntime()?.Plugins?.StatusBar;
    if (!statusBar?.setStyle) return;
    try {
      // Capacitor's LIGHT value means dark status-bar content for a light surface.
      await statusBar.setStyle({ style: 'LIGHT' });
    } catch (error) {
      console.warn('[StatusBarAdapter] Unable to apply status bar style', error);
    }
  }
}

export const statusBarAdapter = new StatusBarAdapter();

import { appLifecycleAdapter } from './AppLifecycleAdapter';
import type { AppLifecycleEvent } from './AppLifecycleAdapter';

const CANVAS_BACKGROUND = [
  'radial-gradient(circle at 18% 0%, rgba(26, 115, 232, .08), transparent 30%)',
  'radial-gradient(circle at 92% 14%, rgba(52, 199, 89, .07), transparent 27%)',
  'linear-gradient(180deg, #f7faff 0%, #f5f6fa 48%, #fafbfd 100%)'
].join(',');

function forceCanvasBackground(): void {
  const root = document.documentElement;
  root.style.setProperty('--background-color', '#F5F6FA');
  root.style.setProperty('--app-canvas-bg', CANVAS_BACKGROUND);
  root.style.background = CANVAS_BACKGROUND;
  document.body.style.background = CANVAS_BACKGROUND;
  const appRoot = document.getElementById('app');
  if (appRoot) appRoot.style.background = CANVAS_BACKGROUND;
}

function logRenderHealth(label: string, lifecycle?: AppLifecycleEvent): void {
  const selectors = ['html', 'body', '#app', '.app-container', '.ai-overlay', '.ai-sheet', '.bottom-sheet-card', '.settings-sheet'];
  const layers = selectors.map((selector) => {
    const element = selector === 'html'
      ? document.documentElement
      : selector === 'body'
        ? document.body
        : document.querySelector<HTMLElement>(selector);
    if (!element) return { selector, present: false };
    const style = getComputedStyle(element);
    return {
      selector,
      present: true,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter
    };
  });
  console.info('[ZhanglLifecycle]', {
    label,
    lifecycle,
    hidden: document.hidden,
    readyState: document.readyState,
    bodyClass: document.body.className,
    layers
  });
}

function repaint(): void {
  forceCanvasBackground();
  document.body.classList.remove('ios-system-transition');
  window.dispatchEvent(new CustomEvent('zhangl-webview-repaint', { detail: { at: Date.now() } }));
}

export function installWebViewRepaintGuard(): void {
  forceCanvasBackground();
  window.addEventListener('zhangl-app-lifecycle', (event) => {
    const detail = (event as CustomEvent<AppLifecycleEvent>).detail;
    logRenderHealth('lifecycle', detail);
    if (detail.state === 'active') return;
    document.body.classList.add('ios-system-transition');
    forceCanvasBackground();
  });
  appLifecycleAdapter.onActive(() => {
    repaint();
    window.setTimeout(repaint, 80);
    window.setTimeout(repaint, 240);
    window.setTimeout(() => logRenderHealth('active-settled'), 520);
    window.setTimeout(() => document.body.classList.remove('ios-system-transition'), 420);
  });
}

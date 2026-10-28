import type { AppLifecycleEvent } from '@/platform/AppLifecycleAdapter';

export interface ForegroundChatLifecycle {
  onChange(listener: (event: AppLifecycleEvent) => void): () => void;
}

export interface InterruptibleChat {
  cancel(sessionId?: string, reason?: 'user' | 'lifecycle'): void;
}

/**
 * Only a real move to the background interrupts a foreground chat. iOS reports
 * `inactive` for Control Center, the notification shade, call banners and
 * permission prompts, and a browser tab that is merely hidden keeps running;
 * cancelling on those threw away answers the user was still waiting for.
 */
export function interruptsForegroundChat(event: Pick<AppLifecycleEvent, 'state' | 'reason'>): boolean {
  return event.state === 'background' && event.reason === 'app-did-enter-background';
}

export function installForegroundChatInterruption(
  lifecycle: ForegroundChatLifecycle,
  chat: InterruptibleChat
): () => void {
  return lifecycle.onChange((event) => {
    if (interruptsForegroundChat(event)) chat.cancel(undefined, 'lifecycle');
  });
}

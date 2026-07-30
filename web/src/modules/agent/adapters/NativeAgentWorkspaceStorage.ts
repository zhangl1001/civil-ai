import { registerPlugin } from '@capacitor/core';
import type { AgentWorkspaceStorage } from '../contracts/AgentWorkspaceStorage';
import { WebAgentWorkspaceStorage } from './WebAgentWorkspaceStorage';

interface NativeAgentWorkspacePlugin {
  append(options: { readonly logKey: string; readonly line: string }): Promise<void>;
  replace(options: { readonly logKey: string; readonly content: string }): Promise<void>;
  read(options: { readonly logKey: string }): Promise<{ readonly content?: string }>;
  delete(options: { readonly logKey: string }): Promise<void>;
}

const nativeAgentWorkspace = registerPlugin<NativeAgentWorkspacePlugin>('NativeAgentWorkspace');

export class NativeAgentWorkspaceStorage implements AgentWorkspaceStorage {
  private readonly fallback = new WebAgentWorkspaceStorage();
  private nativeUnavailable = false;

  async append(logKey: string, line: string): Promise<void> {
    if (this.nativeUnavailable) {
      await this.fallback.append(logKey, line);
      return;
    }
    try {
      await nativeAgentWorkspace.append({ logKey, line });
    } catch (error) {
      if (!isPluginUnavailable(error)) throw error;
      this.disableNativeWorkspace(error);
      await this.fallback.append(logKey, line);
    }
  }

  async read(logKey: string): Promise<string> {
    if (this.nativeUnavailable) return this.fallback.read(logKey);
    try {
      const nativeContent = (await nativeAgentWorkspace.read({ logKey })).content || '';
      const fallbackContent = await this.fallback.read(logKey);
      if (!fallbackContent) return nativeContent;
      for (const line of fallbackContent.split('\n').filter(Boolean)) {
        await nativeAgentWorkspace.append({ logKey, line });
      }
      await this.fallback.delete(logKey);
      return `${nativeContent}${nativeContent && !nativeContent.endsWith('\n') ? '\n' : ''}${fallbackContent}`;
    } catch (error) {
      if (!isPluginUnavailable(error)) throw error;
      this.disableNativeWorkspace(error);
      return this.fallback.read(logKey);
    }
  }

  async replace(logKey: string, content: string): Promise<void> {
    if (this.nativeUnavailable) {
      await this.fallback.replace(logKey, content);
      return;
    }
    try {
      await nativeAgentWorkspace.replace({ logKey, content });
      await this.fallback.delete(logKey);
    } catch (error) {
      if (!isPluginUnavailable(error)) throw error;
      this.disableNativeWorkspace(error);
      await this.fallback.replace(logKey, content);
    }
  }

  async delete(logKey: string): Promise<void> {
    if (this.nativeUnavailable) {
      await this.fallback.delete(logKey);
      return;
    }
    try {
      await nativeAgentWorkspace.delete({ logKey });
      await this.fallback.delete(logKey);
    } catch (error) {
      if (!isPluginUnavailable(error)) throw error;
      this.disableNativeWorkspace(error);
      await this.fallback.delete(logKey);
    }
  }

  private disableNativeWorkspace(error: unknown): void {
    this.nativeUnavailable = true;
    console.warn('[AgentWorkspace] Native plugin unavailable; using the Web storage fallback.', error);
  }
}

function isPluginUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not implemented|unimplemented|plugin.+(?:unavailable|not (?:available|found|registered))/i.test(message);
}

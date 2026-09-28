import { Capacitor, registerPlugin } from '@capacitor/core';
import type { InterviewSpeechMetrics } from '@/domain/interview';

interface NativeSpeechPlugin {
  isAvailable(): Promise<{ available: boolean; onDevice?: boolean; reason?: string }>;
  requestSpeechPermissions(): Promise<{ granted: boolean }>;
  start(): Promise<{ transcript: string; durationSeconds: number }>;
  stop(): Promise<{ transcript: string; durationSeconds: number }>;
}

const speechPlugin = registerPlugin<NativeSpeechPlugin>('SpeechRecognition');

export interface SpeechRecognitionResult {
  transcript: string;
  metrics: InterviewSpeechMetrics;
}

function nativeSpeech(): NativeSpeechPlugin | null {
  return Capacitor.isNativePlatform() ? speechPlugin : null;
}

function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = text.replace(/[\u4e00-\u9fa5]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return cjk + latin;
}

function fillerCount(text: string): number {
  const matches = text.match(/嗯|啊|呃|然后|这个|那个|就是说/g);
  return matches?.length || 0;
}

function metricsFor(transcript: string, durationSeconds: number): InterviewSpeechMetrics {
  const wordCount = countWords(transcript);
  const minutes = Math.max(durationSeconds / 60, 1 / 60);
  return {
    durationSeconds,
    wordCount,
    wordsPerMinute: Math.round(wordCount / minutes),
    fillerCount: fillerCount(transcript)
  };
}

export type SpeechUnavailableReason = 'unsupported_platform' | 'unavailable' | 'on_device_unsupported';

export interface SpeechAvailability {
  available: boolean;
  reason?: SpeechUnavailableReason;
}

export class SpeechRecognitionAdapter {
  /** Only on-device recognition is offered, so the no-upload promise holds. */
  async availability(): Promise<SpeechAvailability> {
    const plugin = nativeSpeech();
    if (!plugin) return { available: false, reason: 'unsupported_platform' };
    try {
      const result = await plugin.isAvailable();
      if (result.available && result.onDevice !== false) return { available: true };
      return {
        available: false,
        reason: result.reason === 'on_device_unsupported' ? 'on_device_unsupported' : 'unavailable'
      };
    } catch {
      return { available: false, reason: 'unavailable' };
    }
  }

  async isAvailable(): Promise<boolean> {
    return (await this.availability()).available;
  }

  async requestPermissions(): Promise<boolean> {
    const plugin = nativeSpeech();
    if (!plugin) return false;
    const result = await plugin.requestSpeechPermissions();
    return Boolean(result.granted);
  }

  async start(): Promise<void> {
    const plugin = nativeSpeech();
    if (!plugin) throw new Error('当前环境不支持语音识别');
    await plugin.start();
  }

  async stop(): Promise<SpeechRecognitionResult> {
    const plugin = nativeSpeech();
    if (!plugin) throw new Error('当前环境不支持语音识别');
    const result = await plugin.stop();
    const transcript = result.transcript || '';
    return {
      transcript,
      metrics: metricsFor(transcript, result.durationSeconds || 0)
    };
  }
}

export const speechRecognitionAdapter = new SpeechRecognitionAdapter();

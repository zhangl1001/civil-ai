import { Capacitor } from '@capacitor/core';
import type { InterviewSpeechMetrics } from '@/domain/interview';

interface NativeSpeechPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestSpeechPermissions(): Promise<{ granted: boolean }>;
  start(): Promise<{ transcript: string; durationSeconds: number }>;
  stop(): Promise<{ transcript: string; durationSeconds: number }>;
}

export interface SpeechRecognitionResult {
  transcript: string;
  metrics: InterviewSpeechMetrics;
}

function nativeSpeech(): NativeSpeechPlugin | null {
  const plugin = (Capacitor as any).Plugins?.SpeechRecognition as NativeSpeechPlugin | undefined;
  return plugin || null;
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

export class SpeechRecognitionAdapter {
  async isAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    const plugin = nativeSpeech();
    if (!plugin) return false;
    try {
      const result = await plugin.isAvailable();
      return Boolean(result.available);
    } catch {
      return false;
    }
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

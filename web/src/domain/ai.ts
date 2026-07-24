export interface AISession {
  id: string;
  projectId: string;
  title: string;
  summary?: string;
  summaryUpdatedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type AIMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AIMessage {
  id: string;
  sessionId: string;
  role: AIMessageRole;
  content: string;
  toolName?: string;
  toolCallId?: string;
  createdAt: number;
}

export type AIProviderType = 'openai' | 'anthropic' | 'custom';

export interface AIConfig {
  provider: AIProviderType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  streamingEnabled?: boolean;
  updatedAt: number;
}

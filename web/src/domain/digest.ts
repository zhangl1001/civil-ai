export type DigestTab = 'news' | 'tips';

export interface DigestItem {
  id: string;
  projectId: string;
  type: DigestTab;
  date: string;
  category: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  source?: string;
  sourceRef?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface DigestSection {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
}

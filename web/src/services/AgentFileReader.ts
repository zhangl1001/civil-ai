import type { JsonObject } from '@/kernel/public';
import { fileRepository } from './FileRepository';
import { projectRepository } from './ProjectRepository';
import { createAgentFileChunk, type AgentFileChunk } from './AgentFileChunk';

export class AgentFileReader {
  async read(argumentsValue: JsonObject): Promise<AgentFileChunk> {
    const path = String(argumentsValue.path || '').trim();
    if (!path || path.includes('..') || !path.startsWith('导入资料/')) {
      throw new Error('只能读取当前对话已经导入的资料文件。');
    }
    const project = await projectRepository.getActiveProject();
    const content = await fileRepository.readText(project.id, path);
    if (!content) throw new Error('没有找到这个导入文件。');
    return createAgentFileChunk(path, content, argumentsValue);
  }
}

export const agentFileReader = new AgentFileReader();

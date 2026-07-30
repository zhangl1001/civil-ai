export interface AgentWorkspaceStorage {
  append(logKey: string, line: string): Promise<void>;
  replace(logKey: string, content: string): Promise<void>;
  read(logKey: string): Promise<string>;
  delete(logKey: string): Promise<void>;
}

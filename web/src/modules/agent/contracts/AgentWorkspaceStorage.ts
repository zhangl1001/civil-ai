export interface AgentWorkspaceStorage {
  append(logKey: string, line: string): Promise<void>;
  read(logKey: string): Promise<string>;
  delete(logKey: string): Promise<void>;
}

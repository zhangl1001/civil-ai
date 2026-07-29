const INTERNAL_AGENT_LABELS: Readonly<Record<string, string>> = {
  'agent.select_skills': '工作流选择',
  'research.true_questions': '真题检索流程',
  'research.current_affairs': '时政检索流程',
  'research.exam_syllabus': '考试大纲检索流程',
  'web.search': '联网搜索',
  web_search: '联网搜索',
  'web.read_page': '网页内容读取',
  web_read_page: '网页内容读取',
  'question_bank.scan': '题目扫描',
  'question_bank.repair': '题目结构修正',
  research_true_questions: '联网真题研究',
  'question_bank.resume': '导入恢复',
  'question_bank.confirm': '导入确认',
  'question_bank.publish': '题库发布',
  'workspace.discover': '本地资源检索',
  'task.read_status': '任务状态查询'
};

export function visibleAssistantText(value: string): string {
  let visible = value.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openThinking = visible.search(/<think>/i);
  if (openThinking >= 0) visible = visible.slice(0, openThinking);
  return replaceInternalAgentNames(visible.replace(/<\/?thinking>/gi, '').trim());
}

export function hasVisibleAssistantContent(value: string): boolean {
  const readable = value
    .replace(/<[^>]*(?:>|$)/g, '')
    .replace(/[\s`*_#[\]()>~|\\-]+/g, '');
  return /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(readable);
}

function replaceInternalAgentNames(value: string): string {
  return Object.entries(INTERNAL_AGENT_LABELS).reduce(
    (text, [name, label]) => text.split(name).join(label),
    value
  );
}

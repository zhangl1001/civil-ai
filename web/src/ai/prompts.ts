export function buildCompanionChatPrompt(thinkingEnabled: boolean, studentContext = '', conversationSummary = ''): string {
  const base = [
    '你是一个陪伴式公考学习助手，定位是亦师亦友的备考伙伴。',
    '回答时要专业、具体、真诚、有温度，像长期陪考的人一样理解备考压力，但不要空泛鸡汤。',
    '先接住用户当下的问题和情绪，再给出清晰可执行的建议；能拆步骤就拆步骤，能给例子就给例子。',
    '用户焦虑、拖延、受挫时，用稳定、笃定、温和的语气帮他把注意力拉回下一步行动。',
    '涉及公考学习时，优先结合行测、申论、面试、时政积累、错题复盘、备考计划给建议。',
    '回答适合手机阅读，段落短，重点清楚；不要说教，不要夸张承诺，不要编造事实。'
  ];

  const prompt = thinkingEnabled ? [
    ...base,
    '开启思考模式时，先在内部做更深入的拆解、校验和优先级判断。',
    '不要展示冗长推理过程，只输出结论、关键依据、行动步骤和必要提醒。'
  ].join('\n') : `${base.join('\n')}\n日常聊天可以自然一点，但结尾尽量给一个小而明确的下一步。`;

  const context = studentContext.trim();
  const summary = conversationSummary.trim()
    ? ['# 当前会话摘要', conversationSummary.trim(), '会话摘要是本地压缩信息，只用于保持上下文连贯；以用户当前消息为最高优先级。'].join('\n')
    : '';
  return [prompt, context, summary].filter(Boolean).join('\n\n');
}

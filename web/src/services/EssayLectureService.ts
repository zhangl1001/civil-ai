import type { EssayLecture } from '@/services/EssayRepository';

const LECTURES: Record<string, EssayLecture> = {
  归纳概括: {
    knowledgePoint: '归纳概括',
    title: '从材料里提炼关键词，不自己发挥',
    summary: '重点训练“找点、合并、分层、规范表达”。答案要忠于材料，短句密集，层次清楚。',
    clues: ['看题干对象：问题、原因、影响、做法', '按材料段落找高频词和转折词', '同类信息合并，避免重复堆砌'],
    methods: ['先按题干对象圈定材料范围，再逐段提取关键词，最后把同类信息压缩成规范短句。'],
    structure: ['总括句点明对象', '分条列出核心要点', '每条用“关键词 + 解释”表达'],
    warnings: ['不要脱离材料写政策口号', '不要把案例细节原样大段摘抄', '不要遗漏反面问题和正面做法'],
    cases: ['材料说法要转成考场表达，少用故事细节，多用问题、原因、影响、做法这类概括词。'],
    drills: ['限时梳理一段材料，训练把案例压缩成不超过20字的要点。']
  },
  综合分析: {
    knowledgePoint: '综合分析',
    title: '先解释，再分析，最后落到启示',
    summary: '综合分析题要体现逻辑链条，既讲是什么，也讲为什么和怎么办。',
    clues: ['题干常见“理解、看法、评价、启示”', '定位观点句、原因句、结果句', '注意材料中的矛盾双方'],
    methods: ['先解释题干关键词，再回到材料找原因、表现和影响，最后用简短结论收束观点。'],
    structure: ['解释题干核心含义', '分角度分析原因、影响或关系', '提出简短结论或启示'],
    warnings: ['不要只罗列材料没有分析', '不要观点先行忽略材料限定', '不要结尾空泛拔高'],
    cases: ['表达时用“其本质在于、主要原因是、现实意义是、因此应当”串起分析层次。'],
    drills: ['把一个材料观点拆成含义、原因、影响、对策四层，训练分析完整度。']
  },
  提出对策: {
    knowledgePoint: '提出对策',
    title: '问题反推对策，保证可执行',
    summary: '对策题核心是针对性和可操作性。每条对策要能对应材料中的具体问题。',
    clues: ['先圈出主体、问题、原因', '材料已有做法优先转化为对策', '缺失环节用常识补足但不能脱离材料'],
    methods: ['按问题、原因、主体三条线反推措施，每条对策写清动作、对象、方式和目标。'],
    structure: ['明确治理主体', '动作动词开头', '补充手段、对象和目标'],
    warnings: ['不要只写“加强、完善”没有具体动作', '不要一条对策解决所有问题', '不要忽略群众、基层、部门协同'],
    cases: ['可写成“由主管部门牵头，建立台账、分类整改、定期回访，推动问题闭环解决”。'],
    drills: ['把材料中的三个问题分别反推出三条对策，检查是否一一对应。']
  },
  贯彻执行: {
    knowledgePoint: '贯彻执行',
    title: '先定文种，再定对象和语气',
    summary: '贯彻执行题既考内容也考格式。格式服务于情境，重点仍是材料要点完整。',
    clues: ['确认文种：通知、倡议、讲话稿、简报等', '确认身份、对象和目的', '提取背景、问题、做法、号召'],
    methods: ['先确定文种和受众，再按背景、任务、措施、号召组织内容，语言要符合身份场景。'],
    structure: ['标题和称谓按文种处理', '正文按背景、主体内容、结尾组织', '语言符合身份和对象'],
    warnings: ['不要格式花哨压缩内容', '不要语气和身份不匹配', '不要漏掉题干要求的特定任务'],
    cases: ['倡议书适合用“让我们从现在做起、从身边做起”形成动员语气。'],
    drills: ['同一材料分别改写成通知和倡议，训练文种差异。']
  },
  申发论述: {
    knowledgePoint: '申发论述',
    title: '立意准确，论证有层次',
    summary: '大作文重点是中心论点、分论点和材料转化。材料是论证起点，不是简单复述。',
    clues: ['抓主题词和价值导向', '找材料中的正反案例', '提炼治理、发展、民生等角度'],
    methods: ['用主题词确定中心论点，再让分论点分别承接意义、问题和路径，避免并列重复。'],
    structure: ['开头亮明中心论点', '三段分论点递进展开', '结尾回扣主题并提升'],
    warnings: ['不要标题和论点脱节', '不要只堆素材缺少论证', '不要分论点并列混乱或重复'],
    cases: ['分论点可写成“以制度供给夯实治理根基，以数字赋能提升服务温度”。'],
    drills: ['围绕同一主题写出三个不重复的分论点，并各配一个材料例证。']
  }
};

function fallback(topic?: string): EssayLecture {
  return LECTURES[topic || ''] || LECTURES.归纳概括;
}

export function essayLectureForTopic(topic?: string): EssayLecture {
  return fallback(topic);
}

export function normalizeEssayLecture(topic: string | undefined, lecture?: Partial<EssayLecture>): EssayLecture {
  const base = fallback(topic);
  return {
    knowledgePoint: lecture?.knowledgePoint?.trim() || base.knowledgePoint,
    title: lecture?.title?.trim() || base.title,
    summary: lecture?.summary?.trim() || base.summary,
    clues: lecture?.clues?.filter(Boolean).length ? lecture.clues.filter(Boolean) : base.clues,
    methods: lecture?.methods?.filter(Boolean).length ? lecture.methods.filter(Boolean) : base.methods,
    structure: lecture?.structure?.filter(Boolean).length ? lecture.structure.filter(Boolean) : base.structure,
    warnings: lecture?.warnings?.filter(Boolean).length ? lecture.warnings.filter(Boolean) : base.warnings,
    cases: lecture?.cases?.filter(Boolean).length ? lecture.cases.filter(Boolean) : base.cases,
    drills: lecture?.drills?.filter(Boolean).length ? lecture.drills.filter(Boolean) : base.drills
  };
}

<template>
  <div class="diagnosis-insight">
    <div class="diagnosis-cause">
      <strong>{{ causeLabel }}</strong>
      <p>{{ detail }}</p>
    </div>

    <div class="diagnosis-dimensions">
      <span class="section-label">涉及维度</span>
      <div class="dimension-list">
        <div v-for="dimension in resolvedDimensions" :key="dimension.code" class="dimension-row">
          <span :class="['dimension-status', dimension.status]"></span>
          <strong>{{ dimensionLabel[dimension.code] }}</strong>
          <em>{{ dimensionStatusLabel[dimension.status] }}</em>
          <p>{{ dimension.evidence }}</p>
        </div>
      </div>
    </div>

    <div class="correction-guide">
      <span class="section-label">针对性纠正</span>
      <strong>{{ resolvedPlan.objective }}</strong>
      <ol>
        <li v-for="step in resolvedPlan.steps" :key="step">{{ step }}</li>
      </ol>
      <dl>
        <div>
          <dt>专项重点</dt>
          <dd>{{ resolvedPlan.practiceFocus }}</dd>
        </div>
        <div>
          <dt>达标标准</dt>
          <dd>{{ resolvedPlan.successCriteria }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  ErrorCauseCode,
  ErrorDiagnosisDimensionCode,
  type ErrorCorrectionPlan,
  type ErrorDiagnosisDimension,
  type ErrorDiagnosisRecord
} from '@/modules/evidence/public';

const props = defineProps<{
  causeCode: ErrorDiagnosisRecord['causeCode'];
  causeLabel: string;
  detail: string;
  dimensions?: readonly ErrorDiagnosisDimension[];
  correctionPlan?: ErrorCorrectionPlan;
}>();

const dimensionLabel: Readonly<Record<ErrorDiagnosisDimension['code'], string>> = {
  [ErrorDiagnosisDimensionCode.KnowledgeConcept]: '知识概念',
  [ErrorDiagnosisDimensionCode.QuestionRecognition]: '题型识别',
  [ErrorDiagnosisDimensionCode.MethodSelection]: '方法选择',
  [ErrorDiagnosisDimensionCode.ReasoningProcess]: '推理过程',
  [ErrorDiagnosisDimensionCode.EvidenceExtraction]: '材料定位',
  [ErrorDiagnosisDimensionCode.CalculationExecution]: '计算执行',
  [ErrorDiagnosisDimensionCode.OptionElimination]: '选项排除',
  [ErrorDiagnosisDimensionCode.TimeStrategy]: '时间策略',
  [ErrorDiagnosisDimensionCode.TransferRetention]: '迁移与保持'
};

const dimensionStatusLabel: Readonly<Record<ErrorDiagnosisDimension['status'], string>> = {
  gap: '存在缺口',
  risk: '需要关注',
  adequate: '表现正常',
  unknown: '证据不足'
};

const resolvedDimensions = computed<readonly ErrorDiagnosisDimension[]>(() => (
  props.dimensions?.length ? props.dimensions : [fallbackDimension(props.causeCode)]
));

const resolvedPlan = computed<ErrorCorrectionPlan>(() => {
  const plan = props.correctionPlan;
  return plan?.objective && plan.steps.length && plan.practiceFocus && plan.successCriteria
    ? plan
    : fallbackPlan(props.causeCode);
});

function fallbackDimension(causeCode: ErrorDiagnosisRecord['causeCode']): ErrorDiagnosisDimension {
  const code = causeDimension[causeCode] ?? ErrorDiagnosisDimensionCode.ReasoningProcess;
  return {
    code,
    status: causeCode === ErrorCauseCode.Unknown ? 'unknown' : 'risk',
    evidence: causeCode === ErrorCauseCode.Unknown
      ? '当前作答证据不足，暂时不能确定具体错误环节。'
      : '根据当前主错因归类，仍需结合后续作答过程继续校准。'
  };
}

const causeDimension: Readonly<Partial<Record<ErrorDiagnosisRecord['causeCode'], ErrorDiagnosisDimension['code']>>> = {
  [ErrorCauseCode.ConceptGap]: ErrorDiagnosisDimensionCode.KnowledgeConcept,
  [ErrorCauseCode.RecognitionError]: ErrorDiagnosisDimensionCode.QuestionRecognition,
  [ErrorCauseCode.MethodSelectionError]: ErrorDiagnosisDimensionCode.MethodSelection,
  [ErrorCauseCode.ReasoningError]: ErrorDiagnosisDimensionCode.ReasoningProcess,
  [ErrorCauseCode.CalculationError]: ErrorDiagnosisDimensionCode.CalculationExecution,
  [ErrorCauseCode.EvidenceExtractionError]: ErrorDiagnosisDimensionCode.EvidenceExtraction,
  [ErrorCauseCode.TrapMisjudgment]: ErrorDiagnosisDimensionCode.OptionElimination,
  [ErrorCauseCode.TimeManagementError]: ErrorDiagnosisDimensionCode.TimeStrategy,
  [ErrorCauseCode.CarelessError]: ErrorDiagnosisDimensionCode.ReasoningProcess,
  [ErrorCauseCode.TransferFailure]: ErrorDiagnosisDimensionCode.TransferRetention,
  [ErrorCauseCode.RetentionFailure]: ErrorDiagnosisDimensionCode.TransferRetention
};

function fallbackPlan(causeCode: ErrorDiagnosisRecord['causeCode']): ErrorCorrectionPlan {
  return correctionPlans[causeCode] ?? correctionPlans[ErrorCauseCode.Unknown]!;
}

const correctionPlans: Readonly<Record<ErrorDiagnosisRecord['causeCode'], ErrorCorrectionPlan>> = {
  [ErrorCauseCode.ConceptGap]: plan('补齐本题依赖的核心概念和适用边界', ['回到讲义定位相关概念并用自己的话复述。', '对比一个正例和一个反例，说明规则何时成立。'], '先做概念辨析题，再进入标准应用题。', '能独立解释概念边界，并连续正确完成 3 道基础变式题。'),
  [ErrorCauseCode.RecognitionError]: plan('建立稳定的题型识别信号', ['圈出题干中的任务词和关键条件。', '先判断题型与考点，再选择解题方法。'], '训练相似题型的快速分类与识别。', '在 20 秒内正确识别连续 4 道题的题型与考点。'),
  [ErrorCauseCode.MethodSelectionError]: plan('把题型特征与正确方法建立对应关系', ['写出本题可用方法及各自适用条件。', '解释误用方法为什么不适合本题。'], '进行同考点、不同解法的对比练习。', '连续 3 道变式题均能先选对方法再作答。'),
  [ErrorCauseCode.ReasoningError]: plan('修复推理链中断或跳步的位置', ['按“条件—推导—结论”重写正确推理链。', '对照自己的答案，标出首次偏离的步骤。'], '训练需要两步以上推导的同类题。', '能完整复述推理链，并连续正确完成 3 道同类题。'),
  [ErrorCauseCode.CalculationError]: plan('稳定计算流程并减少中间步骤失误', ['重新列式并标记单位、基期和符号。', '用估算或逆算复核结果数量级。'], '进行同公式的小题组限时计算。', '连续 5 道计算题结果正确，且平均用时达到当前训练目标。'),
  [ErrorCauseCode.EvidenceExtractionError]: plan('提升材料中的关键信息定位能力', ['把问题中的对象、时间和指标逐一对应到材料。', '圈出直接证据并排除无关信息。'], '训练长材料中的关键词定位与数据对应。', '连续 4 道材料题均能先定位正确证据再作答。'),
  [ErrorCauseCode.TrapMisjudgment]: plan('识别干扰项与正确项的关键差异', ['逐项说明选项成立需要满足的条件。', '比较误选项和正确项在范围、强度或因果上的差异。'], '进行典型干扰项对比和选项强度训练。', '连续 4 道题均能说明错误选项错在哪里。'),
  [ErrorCauseCode.TimeManagementError]: plan('建立与题目价值匹配的时间策略', ['记录卡住的具体步骤和耗时。', '设置本题型止损时间，超时先标记后返回。'], '进行小题组限时训练和跳题策略练习。', '在目标时间内完成同类题组，正确率不低于当前阶段要求。'),
  [ErrorCauseCode.CarelessError]: plan('把检查动作固定进答题流程', ['定位本题可检查的对象：条件、单位、否定词或选项。', '提交前按固定顺序完成一次快速核对。'], '训练容易遗漏条件的短题并执行检查清单。', '连续 5 道同类题无相同遗漏，且能说出检查依据。'),
  [ErrorCauseCode.TransferFailure]: plan('把已会方法迁移到变化后的题目', ['找出新题与熟悉题型不变的核心结构。', '说明变化条件会影响哪一步、不会影响哪一步。'], '进行跨情境、跨表述的变式训练。', '在至少 3 种不同表述下都能正确使用同一方法。'),
  [ErrorCauseCode.RetentionFailure]: plan('通过间隔复习恢复稳定记忆', ['先不看答案回忆概念和步骤。', '对照讲义补齐遗漏，并安排下一次间隔复习。'], '使用 1 天、3 天、7 天间隔复测。', '跨 7 天复测仍能独立完成同类题。'),
  [ErrorCauseCode.Unknown]: plan('先补充作答证据，再确定纠正方向', ['回忆选择该选项时最关键的依据。', '对照解析指出自己最不确定的一步。'], '先完成错因确认，不盲目追加同类题。', '能够明确错误发生在识别、方法、推理、计算或时间中的哪一环。')
};

function plan(
  objective: string,
  steps: readonly string[],
  practiceFocus: string,
  successCriteria: string
): ErrorCorrectionPlan {
  return { objective, steps, practiceFocus, successCriteria };
}
</script>

<style scoped>
.diagnosis-insight { display:flex; flex-direction:column; gap:11px; }
.diagnosis-cause>strong { display:block; color:var(--text-color); font-size:var(--type-size-secondary); }
.diagnosis-cause>p { margin:4px 0 0; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.55; }
.section-label { display:block; margin-bottom:6px; color:var(--text-secondary-color); font-size:var(--type-size-micro); font-weight:var(--type-weight-semibold); }
.dimension-list { display:flex; flex-direction:column; gap:6px; }
.dimension-row { display:grid; grid-template-columns:8px auto 1fr; align-items:center; column-gap:7px; row-gap:2px; }
.dimension-row>strong { font-size:var(--type-size-caption); }
.dimension-row>em { justify-self:end; color:var(--text-secondary-color); font-size:var(--type-size-micro); font-style:normal; }
.dimension-row>p { grid-column:2/4; margin:0; color:var(--text-secondary-color); font-size:var(--type-size-micro); line-height:1.45; }
.dimension-status { width:7px; height:7px; border-radius:50%; background:var(--text-secondary-color); }
.dimension-status.gap { background:var(--red-color); }
.dimension-status.risk { background:var(--orange-color); }
.dimension-status.adequate { background:var(--green-color); }
.correction-guide { padding-top:9px; border-top:1px solid rgba(var(--color-ink-rgb),.065); }
.correction-guide>strong { display:block; font-size:var(--type-size-secondary); line-height:1.45; }
.correction-guide ol { margin:7px 0 0; padding-left:19px; color:var(--text-secondary-color); font-size:var(--type-size-secondary); line-height:1.5; }
.correction-guide li+li { margin-top:4px; }
.correction-guide dl { display:flex; flex-direction:column; gap:5px; margin:9px 0 0; }
.correction-guide dl>div { display:grid; grid-template-columns:56px 1fr; gap:7px; }
.correction-guide dt { color:var(--text-secondary-color); font-size:var(--type-size-micro); }
.correction-guide dd { margin:0; color:var(--text-color); font-size:var(--type-size-micro); line-height:1.45; }
</style>

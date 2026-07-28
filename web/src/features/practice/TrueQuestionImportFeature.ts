import { QuestionImportMethod } from '@/modules/content/public';
import type { AgentWorkflowInvocation } from '@/modules/agent/public';
import type { ModelImageContentPart } from '@/capabilities/ai-runtime/public';

export interface TrueQuestionImportAttachment {
  readonly name: string;
  readonly path: string;
  readonly method: 'plain_text' | 'pdf_text' | 'pdf_ocr' | 'image_ocr' | 'image_vision' | 'mixed';
  readonly pageCount: number;
  readonly imageParts?: readonly ModelImageContentPart[];
}

export type TrueQuestionAttachmentImporter = (files: readonly File[]) => Promise<TrueQuestionImportAttachment>;

export interface PreparedTrueQuestionImport {
  readonly attachment: TrueQuestionImportAttachment;
  readonly prompt: string;
  readonly attachments: readonly ModelImageContentPart[];
  readonly invocation: AgentWorkflowInvocation;
}

export class TrueQuestionImportFeature {
  constructor(private readonly importAttachment: TrueQuestionAttachmentImporter) {}

  async prepare(files: readonly File[]): Promise<PreparedTrueQuestionImport> {
    const attachment = await this.importAttachment(files);
    const importMethod = attachment.method === 'image_vision' || attachment.method === 'image_ocr'
      ? QuestionImportMethod.ImageOcr
      : attachment.method === 'plain_text'
        ? QuestionImportMethod.StructuredFile
        : QuestionImportMethod.DocumentScan;
    return {
      attachment,
      attachments: attachment.imageParts || [],
      prompt: [
        '请把这份资料整理为可确认的真题导入草稿。图片原图已经作为多模态附件提供，请优先理解版面、表格和题目边界。',
        '',
        `【已导入本地文件：${attachment.name}】`,
        `本地路径：${attachment.path}`,
        `建议导入方式：${importMethod}`,
        `输入方式：${attachment.method}，共 ${attachment.pageCount} 页。`,
        attachment.imageParts?.length
          ? `本次包含 ${attachment.imageParts.length} 张图片；请按图片顺序恢复题干、共用材料、小题、选项、图表和题目边界。`
          : '请按需分段读取文本，并形成待确认草稿。',
        '图片中没有答案或解析时保持缺失并标记待确认；来源、年份、地区、模块或题目边界不确定时先向我确认，不得补造或直接发布。'
      ].join('\n'),
      invocation: {
        skillCodes: ['tutor.question_bank_ingestion'],
        systemConstraint: '用户从“导入真题”工作流提交了资料。目标是先形成待确认草稿；只有真实工具成功后才能说明扫描或导入已完成。'
      }
    };
  }

  researchRequest(filterSummary: string): { readonly prompt: string; readonly invocation: AgentWorkflowInvocation } {
    const scope = filterSummary.trim() || '全部来源';
    return {
      prompt: [
      '请联网查找适合当前备考档案的公开真题资料，并准备导入题库。',
      `当前页面范围：${scope}。`,
      '如果年份、地区、考试类型、模块或题量范围仍不明确，先向我确认，不要直接开始大范围检索。',
      '扫描后先展示待确认草稿，来源或题目边界不确定时继续确认，未经确认不得发布。'
      ].join('\n'),
      invocation: {
        skillCodes: ['research.true_questions'],
        systemConstraint: '这是公开真题检索工作流。网络摘要只能作为线索；必须先核验题目正文和来源，未经确认不得标记官方真题或发布。'
      }
    };
  }
}

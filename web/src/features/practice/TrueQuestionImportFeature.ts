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
        '请把这份资料整理为可确认的真题导入草稿。图片原图已经作为临时多模态附件提供；支持视觉输入时优先理解原图版面，不支持时读取本地 OCR 文本继续处理。',
        '',
        `【已导入本地文件：${attachment.name}】`,
        `本地路径：${attachment.path}`,
        `建议导入方式：${importMethod}`,
        `输入方式：${attachment.method}，共 ${attachment.pageCount} 页。`,
        attachment.imageParts?.length
          ? `本次包含 ${attachment.imageParts.length} 张图片；请按图片顺序结合原图和本地提取文本，恢复题干、共用材料、小题、选项、图表和题目边界。`
          : '请按需分段读取文本，并形成待确认草稿。',
        '图片中没有答案或解析时保持缺失并标记待确认；来源、年份、地区、模块或题目边界不确定时先向我确认，不得补造或直接发布。'
      ].join('\n'),
      invocation: {
        skillNames: ['tutor.question_bank_ingestion'],
        systemConstraint: '用户从“导入真题”工作流提交了资料。目标是先形成待确认草稿；只有真实工具成功后才能说明扫描或导入已完成。'
      }
    };
  }
}

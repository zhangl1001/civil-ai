import { QuestionImportMethod } from '@/modules/content/public';
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
        '请扫描并导入这份真题资料。图片原图已经作为多模态附件提供，请优先通过视觉理解识别版面和语义，不要把图片当成普通纯文本。',
        '',
        `【已导入本地文件：${attachment.name}】`,
        `本地路径：${attachment.path}`,
        `建议导入方式：${importMethod}`,
        `输入方式：${attachment.method}，共 ${attachment.pageCount} 页。`,
        attachment.imageParts?.length
          ? `本次包含 ${attachment.imageParts.length} 张图片；请按图片顺序恢复题干、共用材料、小题、选项、图表和题目边界。`
          : '请用 file.read_text 按需分段读取文本，再调用真题扫描工具生成待确认草稿。',
        '识别后调用 question_bank.scan 生成结构化待确认草稿：题干、共用材料、小题、选项、图表/图片、答案、解析和来源分别放入对应区域。不要把整张图片 OCR 成一段扁平文本。',
        '图片中没有答案或解析时保持缺失并标记待确认，禁止为了通过校验自行补造；图形题应使用 visual SVG 区域，并保持图形顺序、比例和相对位置。',
        '来源身份、考试年份、地区、模块或题目边界不确定时先向我确认；未经确认不得标记为官方真题或直接发布。'
      ].join('\n')
    };
  }

  researchPrompt(filterSummary: string): string {
    const scope = filterSummary.trim() || '全部来源';
    return [
      '请联网查找适合当前备考档案的公开真题资料，并准备导入题库。',
      `当前页面范围：${scope}。`,
      '先使用 web.search 查找候选来源，必要时再用 web.read_page 核验原文。彼此独立且确有必要的搜索方向可以并行。',
      '如果年份、地区、考试类型、模块或题量范围仍不明确，先向我确认，不要直接开始大范围检索。',
      '只把能够核验题目正文和来源的内容送入 question_bank.scan；网络摘要只能作为线索，不能补造题目、答案或官方身份。',
      '扫描后先展示待确认草稿，来源或题目边界不确定时继续确认，未经确认不得发布。'
    ].join('\n');
  }
}

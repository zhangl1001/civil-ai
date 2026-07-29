import type { ContentBlock, ContentDocument } from '../contracts/ContentDocument';
import type { SingleChoiceQuestionContent } from '../contracts/QuestionContent';
import {
  ContentBlockType,
  QuestionPresentationCode,
  QuestionRegionCode,
  QuestionRegionLayoutCode
} from './ContentCodes';
import { contentDocumentText } from './ContentDocumentText';

const LONG_MATERIAL_CHARACTERS = 420;
const markdownTablePattern = /^\s*\|.+\|\s*\n\s*\|\s*:?-{3,}/m;
const inlineSvgPattern = /<svg\b[\s\S]*?<\/svg>/i;

export interface QuestionPresentationDefinition {
  readonly code: QuestionPresentationCode;
  readonly regions: readonly QuestionRegionCode[];
  readonly materialMode: 'inline' | 'workspace';
  readonly optionLayout: 'vertical';
  readonly navigationScope: 'question' | 'material_group';
}

const presentationDefinitions: Readonly<Record<QuestionPresentationCode, QuestionPresentationDefinition>> = {
  standard_choice: definition(QuestionPresentationCode.StandardChoice, false, false),
  graphic_choice: definition(QuestionPresentationCode.GraphicChoice, false, false),
  shared_material_choice: definition(QuestionPresentationCode.SharedMaterialChoice, true, true),
  data_material_choice: definition(QuestionPresentationCode.DataMaterialChoice, true, true),
  long_reading_choice: definition(QuestionPresentationCode.LongReadingChoice, true, false)
};

const regionLayoutDefinitions: Readonly<Record<QuestionRegionLayoutCode, readonly QuestionRegionCode[]>> = {
  practice: [
    QuestionRegionCode.Material,
    QuestionRegionCode.Prompt,
    QuestionRegionCode.Options,
    QuestionRegionCode.Explanation
  ],
  wrong_book: [
    QuestionRegionCode.Material,
    QuestionRegionCode.Prompt,
    QuestionRegionCode.Options,
    QuestionRegionCode.Explanation
  ],
  flashcard: [
    QuestionRegionCode.Material,
    QuestionRegionCode.Prompt,
    QuestionRegionCode.Options,
    QuestionRegionCode.Diagnosis,
    QuestionRegionCode.Explanation
  ]
};

export function resolveQuestionPresentation(
  question: Omit<SingleChoiceQuestionContent, 'presentationCode'> & { readonly presentationCode?: string }
): QuestionPresentationCode {
  if (isPresentationCode(question.presentationCode)) return question.presentationCode;
  const documents = [question.material, question.prompt, ...question.options.map((option) => option.content)]
    .filter((document): document is ContentDocument => Boolean(document));
  const hasTable = documents.some(hasDataTable);
  const containsGraphic = documents.some(documentHasGraphic);
  if (question.materialGroupId && hasTable) return QuestionPresentationCode.DataMaterialChoice;
  if (question.materialGroupId) return QuestionPresentationCode.SharedMaterialChoice;
  if (containsGraphic) return QuestionPresentationCode.GraphicChoice;
  if (question.material && contentDocumentText(question.material).replace(/\s+/g, '').length >= LONG_MATERIAL_CHARACTERS) {
    return QuestionPresentationCode.LongReadingChoice;
  }
  return QuestionPresentationCode.StandardChoice;
}

export function questionUsesMaterialWorkspace(code: QuestionPresentationCode): boolean {
  return questionPresentationDefinition(code).materialMode === 'workspace';
}

export function questionPresentationDefinition(code: QuestionPresentationCode): QuestionPresentationDefinition {
  return presentationDefinitions[code];
}

export function questionRegionOrder(layout: QuestionRegionLayoutCode): readonly QuestionRegionCode[] {
  return regionLayoutDefinitions[layout];
}

function hasDataTable(document: ContentDocument): boolean {
  return document.blocks.some((block) => blockHasType(block, ContentBlockType.DataTable)
    || (block.type === ContentBlockType.Text && markdownTablePattern.test(block.source)));
}

function documentHasGraphic(document: ContentDocument): boolean {
  return document.blocks.some((block) => (
    blockHasType(block, ContentBlockType.SvgDiagram)
    || blockHasType(block, ContentBlockType.Image)
    || (block.type === ContentBlockType.Text && inlineSvgPattern.test(block.source))
  ));
}

function blockHasType(block: ContentBlock, type: ContentBlockType): boolean {
  if (block.type === type) return true;
  return block.type === ContentBlockType.Callout
    ? block.blocks.some((child) => blockHasType(child, type))
    : false;
}

function isPresentationCode(value: string | undefined): value is QuestionPresentationCode {
  return Object.values(QuestionPresentationCode).some((code) => code === value);
}

function definition(
  code: QuestionPresentationCode,
  workspace: boolean,
  grouped: boolean
): QuestionPresentationDefinition {
  return {
    code,
    regions: [
      // Material is a stable content block for every presentation. The
      // workspace mode changes layout/navigation, not whether the question
      // can render its supporting stem.
      QuestionRegionCode.Material,
      QuestionRegionCode.Prompt,
      QuestionRegionCode.Options,
      QuestionRegionCode.Explanation,
      QuestionRegionCode.Diagnosis
    ],
    materialMode: workspace ? 'workspace' : 'inline',
    optionLayout: 'vertical',
    navigationScope: grouped ? 'material_group' : 'question'
  };
}

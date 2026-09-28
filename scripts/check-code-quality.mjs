import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/src');
const defaultMaximumLines = 600;
const legacyLineBudgets = new Map(Object.entries({
  'components/AIChatSheet.vue': 1_885,
  'views/EssayView.vue': 1_274,
  'views/ProfileView.vue': 1_073,
  'services/ChatAgentService.ts': 951,
  'modules/content/application/RunStructuredObjectiveGenerationWorkflow.ts': 921,
  'views/HomeView.vue': 909,
  'features/practice/TutorPracticeCenterView.vue': 852,
  'composition-root/agent/BusinessAgentExecutors.ts': 843,
  'views/ExamView.vue': 804,
  'features/practice/TutorPracticeSessionView.vue': 725,
  'modules/evidence/adapters/SqliteLearningFactRepositories.ts': 701,
  'modules/content/adapters/SqliteContentRepository.ts': 668,
  'views/InterviewView.vue': 658,
  'features/onboarding/OnboardingView.vue': 651,
  'components/TaskDock.vue': 642,
  'modules/candidate/adapters/SqliteCandidateRepository.ts': 607
}));

const files = await sourceFiles(root);
const failures = [];
let neverAssertionCount = 0;
const paginationComponent = 'capabilities/design-system/components/InfiniteScrollPagination.vue';
for (const file of files) {
  const relative = path.relative(root, file);
  const content = await readFile(file, 'utf8');
  const lineCount = content.split(/\r?\n/).length;
  const maximum = legacyLineBudgets.get(relative) ?? defaultMaximumLines;
  if (lineCount > maximum) failures.push(`${relative}: ${lineCount} lines exceeds budget ${maximum}`);
  if (/\b(?:as\s+any|Record<[^>]+,\s*any>|:\s*any\b|<any>)/.test(content)) {
    failures.push(`${relative}: explicit any is forbidden`);
  }
  if (/@ts-(?:ignore|nocheck)/.test(content)) failures.push(`${relative}: TypeScript checks may not be bypassed`);
  if (relative !== paginationComponent && /\bIntersectionObserver\b/.test(content)) {
    failures.push(`${relative}: mobile list pagination must use InfiniteScrollPagination`);
  }
  neverAssertionCount += content.match(/\bas\s+never\b/g)?.length ?? 0;
  if (relative.endsWith('.vue')) failures.push(...labelWrappedButtons(relative, content));
}
assert.ok(neverAssertionCount <= 7, `as never debt increased: ${neverAssertionCount} > 7`);
assert.deepEqual(failures, [], `Code quality check failed:\n${failures.join('\n')}`);
console.log(`Code quality check passed (${files.length} files, explicit any: 0, as never debt: ${neverAssertionCount}/7).`);

/**
 * A <label> activates its first labelable descendant when anything inside it
 * is tapped, so a caption wrapped around option buttons silently selects the
 * first option (tapping "服务商" switched the AI provider). FormField renders a
 * <label> unless it is given `group`. Button groups need a non-label wrapper
 * such as <div role="group" aria-labelledby>.
 */
function labelWrappedButtons(relative, content) {
  const template = /^<template\b[^>]*>([\s\S]*)^<\/template>/m.exec(content);
  if (!template) return [];
  const offset = template.index + template[0].indexOf(template[1]);
  const source = template[1].replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const openWrappers = [];
  const found = [];
  const tags = /<(\/?)(label|FormField|button|SegmentedControl)\b/g;
  for (let match = tags.exec(source); match; match = tags.exec(source)) {
    const [, closing, name] = match;
    const tagText = source.slice(match.index, tagEnd(source, match.index) + 1);
    const line = content.slice(0, offset + match.index).split('\n').length;
    if (closing) {
      if (name === 'label' || name === 'FormField') openWrappers.pop();
      continue;
    }
    if (name === 'label' || name === 'FormField') {
      if (!/\/>$/.test(tagText)) openWrappers.push({ labelling: name === 'label' || !/\sgroup(?=[\s>=/])/.test(tagText), line });
      continue;
    }
    const wrapper = openWrappers.findLast((item) => item.labelling);
    if (wrapper) found.push(`${relative}:${line}: <${name}> inside the <label> opened at line ${wrapper.line}; use <div role="group" aria-labelledby> (or FormField group)`);
  }
  return found;
}

function tagEnd(source, start) {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return source.length - 1;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|vue)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

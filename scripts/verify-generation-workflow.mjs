import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, '../web');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const content = await server.ssrLoadModule('/src/modules/content/public.ts');
  const machine = new content.GenerationWorkflowMachine();
  let workflow = {
    id: 'workflow:test',
    examCycleId: 'cycle:test',
    generationSpecId: 'spec:test',
    workflowType: 'lecture_with_questions',
    status: content.GenerationWorkflowStatus.Queued,
    currentStep: content.GenerationWorkflowStep.PrepareContext,
    attemptCount: 0,
    validation: {},
    idempotencyKey: 'generation:test',
    startedAt: 1000,
    updatedAt: 1000,
    version: 1
  };
  const steps = [
    content.GenerationWorkflowStep.CompilePrompt,
    content.GenerationWorkflowStep.InvokeModel,
    content.GenerationWorkflowStep.ParseStructure,
    content.GenerationWorkflowStep.ValidateSchema,
    content.GenerationWorkflowStep.ValidateDomain,
    content.GenerationWorkflowStep.QualityReview,
    content.GenerationWorkflowStep.StageResult,
    content.GenerationWorkflowStep.CommitResult,
    content.GenerationWorkflowStep.PublishOutbox,
    content.GenerationWorkflowStep.Complete
  ];
  for (const step of steps) workflow = machine.advance(workflow, step, workflow.updatedAt + 1);
  assert.equal(workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(workflow.version, 11);
  assert.equal(workflow.completedAt, 1010);
  assert.throws(() => machine.advance(workflow, content.GenerationWorkflowStep.Complete, 1011), /already terminal/);

  const fresh = { ...workflow, status: content.GenerationWorkflowStatus.Running, currentStep: content.GenerationWorkflowStep.CompilePrompt };
  assert.throws(() => machine.advance(fresh, content.GenerationWorkflowStep.ValidateSchema, 1020), /Illegal generation step/);
  const failed = machine.fail(fresh, 'provider.rate_limited', 1020);
  assert.equal(failed.status, content.GenerationWorkflowStatus.Failed);
  assert.equal(failed.errorCode, 'provider.rate_limited');

  const sqliteGenerationRepositorySource = await readFile(path.join(
    webRoot,
    'src/modules/content/adapters/SqliteGenerationRepository.ts'
  ), 'utf8');
  const generationSpecInsert = sqliteGenerationRepositorySource.match(
    /INSERT INTO generation_specs\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/
  );
  assert.ok(generationSpecInsert, 'SQLite generation spec INSERT must be present');
  const specColumnCount = generationSpecInsert[1].split(',').length;
  const specBindingCount = (generationSpecInsert[2].match(/\?/g) || []).length;
  assert.equal(
    specBindingCount,
    specColumnCount,
    'SQLite generation spec INSERT must bind exactly one value for every declared column'
  );
  assert.equal(specColumnCount, 21, 'Generation spec must persist its source Agent run ID');
  assert.match(generationSpecInsert[1], /source_agent_run_id/);
  console.log('Generation workflow verification passed.');
} finally {
  await server.close();
}

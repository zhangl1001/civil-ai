import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const sourceRoot = path.join(projectRoot, 'web/src');
const baselinePath = path.join(scriptDirectory, 'architecture-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const violations = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    return /\.(ts|tsx|vue)$/.test(entry.name) ? [absolutePath] : [];
  });
}

function relativePath(absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

function importsFrom(source) {
  const imports = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.push(match[1]);
  }
  return imports;
}

function addViolation(file, message) {
  violations.push(`${file}: ${message}`);
}

const files = walk(sourceRoot);
const directDatabaseCounts = new Map();
const sourceByFile = new Map();
const dependencyGraph = new Map();

function isNewArchitectureFile(file) {
  return /^web\/src\/(kernel|modules|capabilities|features|composition-root)\//.test(file);
}

function resolveLocalImport(fromAbsolutePath, specifier) {
  let basePath;
  if (specifier.startsWith('@/')) {
    basePath = path.join(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    basePath = path.resolve(path.dirname(fromAbsolutePath), specifier);
  } else {
    return undefined;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.vue`,
    path.join(basePath, 'public.ts'),
    path.join(basePath, 'index.ts')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

for (const absolutePath of files) {
  const file = relativePath(absolutePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const imports = importsFrom(source);
  sourceByFile.set(file, { absolutePath, imports });
  const directDatabaseCount = imports.filter((specifier) => specifier === '@/db/database').length;
  if (directDatabaseCount > 0) directDatabaseCounts.set(file, directDatabaseCount);

  const moduleMatch = file.match(/^web\/src\/modules\/([^/]+)\/([^/]+)\//);
  const capabilityMatch = file.match(/^web\/src\/capabilities\/([^/]+)\//);
  const featureMatch = file.match(/^web\/src\/features\/([^/]+)\//);

  if ((moduleMatch || capabilityMatch || featureMatch) && imports.includes('@/db/database')) {
    addViolation(file, 'new architecture code must not import the legacy database adapter');
  }

  if (moduleMatch) {
    const [, moduleName, layer] = moduleMatch;
    for (const specifier of imports) {
      const crossModule = specifier.match(/^@\/modules\/([^/]+)\/(.+)$/);
      if (crossModule && crossModule[1] !== moduleName && crossModule[2] !== 'public') {
        addViolation(file, `cross-module import must use ${crossModule[1]}/public, got ${specifier}`);
      }
      if (layer === 'domain' && (
        specifier === 'vue'
        || specifier === 'pinia'
        || specifier.startsWith('@capacitor/')
        || specifier.startsWith('@/ai/')
        || specifier.startsWith('@/services/')
        || specifier.startsWith('@/stores/')
        || specifier.startsWith('@/tasks/')
        || specifier.startsWith('@/views/')
        || specifier.startsWith('@/components/')
        || specifier.startsWith('@/capabilities/')
      )) {
        addViolation(file, `domain layer cannot depend on ${specifier}`);
      }
      if (layer === 'application' && (
        specifier === 'vue'
        || specifier === 'pinia'
        || specifier.startsWith('@capacitor/')
        || specifier.startsWith('@/views/')
        || specifier.startsWith('@/components/')
      )) {
        addViolation(file, `application layer cannot depend on ${specifier}`);
      }
    }
  }

  if (capabilityMatch) {
    for (const specifier of imports) {
      if (specifier.startsWith('@/modules/')) {
        addViolation(file, `technical capability cannot depend on business module ${specifier}`);
      }
    }
  }

  if (featureMatch) {
    for (const specifier of imports) {
      const moduleImport = specifier.match(/^@\/modules\/([^/]+)\/(.+)$/);
      if (moduleImport && moduleImport[2] !== 'public') {
        addViolation(file, `feature must use module public API, got ${specifier}`);
      }
      if (specifier.startsWith('@/services/') || specifier.startsWith('@/db/')) {
        addViolation(file, `new feature cannot depend on legacy runtime ${specifier}`);
      }
    }
  }
}

for (const [file, entry] of sourceByFile) {
  if (!isNewArchitectureFile(file)) continue;
  const dependencies = new Set();
  for (const specifier of entry.imports) {
    const resolved = resolveLocalImport(entry.absolutePath, specifier);
    if (!resolved) continue;
    const resolvedFile = relativePath(resolved);
    if (isNewArchitectureFile(resolvedFile)) dependencies.add(resolvedFile);
  }
  dependencyGraph.set(file, dependencies);
}

const visiting = new Set();
const visited = new Set();
const stack = [];

function visit(file) {
  if (visited.has(file)) return;
  if (visiting.has(file)) {
    const cycleStart = stack.indexOf(file);
    addViolation(file, `circular dependency: ${[...stack.slice(cycleStart), file].join(' -> ')}`);
    return;
  }
  visiting.add(file);
  stack.push(file);
  for (const dependency of dependencyGraph.get(file) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of dependencyGraph.keys()) visit(file);

const allowedDatabaseImports = baseline.legacyDirectDatabaseImports;
for (const [file, count] of directDatabaseCounts) {
  const allowedCount = allowedDatabaseImports[file] ?? 0;
  if (count > allowedCount) {
    addViolation(file, `legacy database imports increased from ${allowedCount} to ${count}`);
  }
}

for (const [file, allowedCount] of Object.entries(allowedDatabaseImports)) {
  const actualCount = directDatabaseCounts.get(file) ?? 0;
  if (actualCount < allowedCount) {
    console.warn(`[architecture] baseline can be reduced: ${file} (${allowedCount} -> ${actualCount})`);
  }
}

if (violations.length > 0) {
  console.error('Architecture boundary check failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Architecture boundary check passed (${files.length} source files, ${directDatabaseCounts.size} legacy DB import files).`);

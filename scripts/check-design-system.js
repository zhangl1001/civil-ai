#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'web/src');
const bannedWeight = /font-weight:\s*(?:430|450|520|620|650|700|750|800|850|900)\b/g;
const hardcodedSize = /font-size:\s*(?:\d+(?:\.\d+)?)px\b/g;

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(full);
    return /\.(?:vue|css)$/.test(entry.name) ? [full] : [];
  });
}

const violations = [];
for (const file of collectFiles(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of [bannedWeight, hardcodedSize]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${path.relative(root, file)}:${line} ${match[0]}`);
    }
  }
}

if (violations.length) {
  console.error('check-design-system: typography must use shared design tokens');
  violations.slice(0, 40).forEach((item) => console.error(`- ${item}`));
  if (violations.length > 40) console.error(`- and ${violations.length - 40} more`);
  process.exit(1);
}

const tokenSource = fs.readFileSync(path.join(sourceRoot, 'assets/styles/design-tokens.css'), 'utf8');
for (const token of ['--font-family-sans', '--type-size-body', '--surface-card', '--surface-sheet', '--radius-card', '--shadow-card']) {
  if (!tokenSource.includes(token)) {
    console.error(`check-design-system: missing ${token}`);
    process.exit(1);
  }
}

console.log('check-design-system: OK');

import fs from 'node:fs';
import path from 'node:path';

const roots = ['api', 'shared'];
const sourceExtensions = ['.ts', '.tsx', '.js', '.mjs', '.json'];
const importPattern = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function resolveSourceFile(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(base)
    ? [base, ...sourceExtensions.map((extension) => base.replace(/\.[^.]+$/, extension))]
    : sourceExtensions.map((extension) => `${base}${extension}`).concat(
        sourceExtensions.map((extension) => path.join(base, `index${extension}`)),
      );

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const failures = [];
const visited = new Set();
const filesToCheck = roots.flatMap((root) => walk(root));

function checkFile(file) {
  if (visited.has(file) || !sourceExtensions.includes(path.extname(file))) return;
  visited.add(file);

  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;

    if (path.extname(specifier) === '.json') {
      const statementEnd = source.indexOf(';', match.index ?? 0);
      const importStatement = source.slice(match.index ?? 0, statementEnd === -1 ? undefined : statementEnd);
      if (!/\bwith\s*\{[^}]*\btype\s*:\s*['"]json['"][^}]*\}/.test(importStatement)) {
        failures.push(`${file}: JSON import "${specifier}" must include with { type: 'json' }`);
      }
    }

    if (!path.extname(specifier)) {
      failures.push(`${file}: relative import "${specifier}" must use its runtime .js extension`);
    }

    const resolved = resolveSourceFile(file, specifier);
    if (!resolved) {
      failures.push(`${file}: relative import "${specifier}" does not resolve to a source file`);
      continue;
    }

    checkFile(resolved);
  }
}

for (const root of roots) {
  for (const file of walk(root)) checkFile(file);
}

if (failures.length > 0) {
  console.error('Server import check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Server import check passed.');
}

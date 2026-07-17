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

function resolvesToSourceFile(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(base)
    ? [base, ...sourceExtensions.map((extension) => base.replace(/\.[^.]+$/, extension))]
    : sourceExtensions.map((extension) => `${base}${extension}`).concat(
        sourceExtensions.map((extension) => path.join(base, `index${extension}`)),
      );

  return candidates.some((candidate) => fs.existsSync(candidate));
}

const failures = [];
for (const root of roots) {
  for (const file of walk(root)) {
    if (!sourceExtensions.includes(path.extname(file))) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;

      if (!path.extname(specifier)) {
        failures.push(`${file}: relative import "${specifier}" must use its runtime .js extension`);
      } else if (!resolvesToSourceFile(file, specifier)) {
        failures.push(`${file}: relative import "${specifier}" does not resolve to a source file`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Server import check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Server import check passed.');
}

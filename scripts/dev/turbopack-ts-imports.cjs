const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Turbopack lacks Webpack's extensionAlias; keep runtime .js imports in source.
module.exports = function resolveTypeScriptImports(source) {
  if (!source.includes('.js')) return source;

  const file = ts.createSourceFile(this.resourcePath, source, ts.ScriptTarget.Latest, true);
  const replacements = [];

  function visit(node) {
    const parent = node.parent;
    const isModuleSpecifier =
      parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node;
    const isDynamicImport =
      parent && ts.isCallExpression(parent) && parent.arguments[0] === node && parent.expression.kind === ts.SyntaxKind.ImportKeyword;

    if ((isModuleSpecifier || isDynamicImport) && ts.isStringLiteral(node)) {
      const specifier = node.text;
      if (specifier.startsWith('.') && specifier.endsWith('.js')) {
        const base = path.resolve(path.dirname(file.fileName), specifier.slice(0, -3));
        if (fs.existsSync(`${base}.ts`) || fs.existsSync(`${base}.tsx`)) {
          replacements.push({ start: node.getStart(file) + 1, end: node.end - 1, value: specifier.slice(0, -3) });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(file);
  let output = source;
  for (const { start, end, value } of replacements.reverse()) {
    output = output.slice(0, start) + value + output.slice(end);
  }
  return output;
};

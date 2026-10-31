import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function lookModal(source: string) {
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'Modal' &&
      node.getText(ast).includes('testID="look-editor"')) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(matches.length, 1, 'Exactly one native look presentation must be reviewed');
  const modal = matches[0]!;
  const attributes = modal.openingElement.attributes.properties;
  const orientation = attributes.find((value): value is ts.JsxAttribute =>
    ts.isJsxAttribute(value) && value.name.getText(ast) === 'supportedOrientations');
  assert.ok(orientation?.initializer && ts.isJsxExpression(orientation.initializer) &&
    orientation.initializer.expression && ts.isArrayLiteralExpression(orientation.initializer.expression),
  'Look presentation must explicitly support app orientations instead of inheriting portrait');
  const values = orientation.initializer.expression.elements.map(value => ts.isStringLiteral(value) ? value.text : '');
  assert.ok(values.includes('portrait') && values.includes('landscape'), 'Look must retain portrait and both landscape directions');
  const presentation = attributes.find((value): value is ts.JsxAttribute =>
    ts.isJsxAttribute(value) && value.name.getText(ast) === 'presentationStyle');
  assert.ok(presentation?.initializer && ts.isStringLiteral(presentation.initializer) &&
    presentation.initializer.text === 'fullScreen', 'Look must preserve full-screen presentation within the current app window');
  return { ast, orientation };
}
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
test('actual look modal explicitly preserves supported app orientations', () => { lookModal(source); });
test('regression check rejects removal of the actual supported orientation prop', () => {
  const { ast, orientation } = lookModal(source);
  const missing = source.slice(0, orientation.getStart(ast)) + source.slice(orientation.getEnd());
  assert.throws(() => lookModal(missing), /explicitly support app orientations/);
});

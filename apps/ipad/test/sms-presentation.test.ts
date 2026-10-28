import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Element = ts.JsxElement | ts.JsxSelfClosingElement;
const opening = (node: Element) => ts.isJsxElement(node) ? node.openingElement : node;
function elements(source: string, name: string) {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Element[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { ast, found };
}
function attribute(node: Element, name: string) {
  return opening(node).attributes.properties.find((value): value is ts.JsxAttribute =>
    ts.isJsxAttribute(value) && value.name.getText() === name);
}
function literal(node: Element, name: string) {
  const value = attribute(node, name)?.initializer;
  return value && ts.isStringLiteral(value) ? value.text : undefined;
}

function checkPlacement(source: string) {
  const { found } = elements(source, 'App.tsx');
  const sms = found.filter(node => opening(node).tagName.getText() === 'SmsShare');
  assert.equal(sms.length, 1, 'Exactly one SMS form must own the send guard');
  const card = found.find(node => ts.isJsxElement(node) && attribute(node, 'style')?.initializer?.getText() === '{styles.shareCard}');
  assert.ok(card && ts.isJsxElement(card), 'Share actions card is required');
  const children = card.children.filter((node): node is Element => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node));
  const next = children.findIndex(node => literal(node, 'testID') === 'next-guest');
  assert.ok(next > 0 && children[next - 1] === sms[0], 'SMS action must be directly above Next guests in the same card');
}

function checkModal(source: string) {
  const { ast, found } = elements(source, 'SmsShare.tsx');
  const matches = found.filter(node => opening(node).tagName.getText() === 'Modal');
  assert.equal(matches.length, 1);
  const modal = matches[0]!;
  assert.equal(literal(modal, 'presentationStyle'), 'overFullScreen', 'Transparent SMS form must cover the existing window');
  assert.ok(attribute(modal, 'transparent'));
  const orientation = attribute(modal, 'supportedOrientations');
  assert.ok(orientation?.initializer && ts.isJsxExpression(orientation.initializer) &&
    orientation.initializer.expression && ts.isArrayLiteralExpression(orientation.initializer.expression),
  'SMS form must explicitly support current app orientations');
  const values = orientation.initializer.expression.elements.map(value => ts.isStringLiteral(value) ? value.text : '');
  for (const value of ['portrait', 'portrait-upside-down', 'landscape']) assert.ok(values.includes(value), `Missing SMS orientation: ${value}`);
  return { ast, orientation };
}

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const sms = readFileSync(new URL('../src/SmsShare.tsx', import.meta.url), 'utf8');
test('actual share card places a single SMS action directly above Next guests', () => checkPlacement(app));
test('placement guard rejects moving SMS back into the story column', () => {
  const { found } = elements(app, 'App.tsx');
  const entry = found.find(node => opening(node).tagName.getText() === 'SmsShare')!;
  const removed = app.slice(0, entry.getStart()) + app.slice(entry.getEnd());
  const wrong = removed.replace('<View style={styles.shareStory}>', `<View style={styles.shareStory}>${entry.getText()}`);
  assert.throws(() => checkPlacement(wrong), /directly above Next guests/);
});
test('actual SMS modal preserves native orientation and window presentation', () => { checkModal(sms); });
test('modal guard rejects missing orientation support or sheet presentation', () => {
  const { ast, orientation } = checkModal(sms);
  const missing = sms.slice(0, orientation.getStart(ast)) + sms.slice(orientation.getEnd());
  assert.throws(() => checkModal(missing), /explicitly support/);
  assert.throws(() => checkModal(sms.replace('presentationStyle="overFullScreen"', 'presentationStyle="pageSheet"')), /existing window/);
});

test('SMS hiding is presentation-only and leaves connection storage and queued work untouched', () => {
  assert.match(sms, /if \(!enabled\) return null/);
  assert.match(app, /enabled=\{preferencesRef\.current\.smsUiEnabled !== false\}/);
  assert.match(app, /accessibilityLabel="Show text-message option"/);
  assert.doesNotMatch(sms, /clearConnection|deleteItemAsync|removeJob|clearActiveSession/);
});
test('send locks synchronously before the first await and keeps Sending visible through refresh', () => {
  const submit = sms.slice(sms.indexOf('async function submit()'), sms.indexOf('if (!enabled) return null'));
  assert.ok(submit.indexOf('sending.current = true') < submit.indexOf('await queueSessionShare'));
  assert.ok(submit.indexOf('await onChanged()') < submit.indexOf('setVisible(false)'));
  assert.match(sms, /busy \? 'Sending…'/);
  assert.match(sms, /showSoftInputOnFocus=\{false\}/);
  assert.match(sms, /testID="sms-number-pad"/);
});

/** Build a separate synthetic evidence package; never rewrite historical packages. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const arguments_ = process.argv.slice(2);
if (arguments_.includes('--help')) { console.log('Usage: node tools/native-visual/new-session/orientation-retake-build-evidence.mjs [--provisional]\nBuilds only orientation-retake-* evidence after a passing actual-JSX run. --help writes nothing.'); process.exit(0); }
assert.ok(arguments_.every(argument => argument === '--provisional'), 'Unknown argument');
const root = arguments_.includes('--provisional') ? '.cache/orientation-retake-provisional' : 'artifacts/visual';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = JSON.parse(await readFile(`${root}/orientation-retake-checks.json`));
const boundary = JSON.parse(await readFile(`${root}/orientation-retake-bundle-boundary.json`));
assert.equal(report.status, 'passed');
for (const section of ['sourceHashes', 'fixtureSourceHashes']) {
  assert.deepEqual(report[section], boundary[section]);
  for (const [file, expected] of Object.entries(report[section])) assert.equal(hash(await readFile(file)), expected, file);
}
for (const [file, expected] of Object.entries(report.toolHashes)) assert.equal(hash(await readFile(file)), expected, file);
for (const shot of report.screenshots) assert.equal(hash(await readFile(shot.file)), shot.sha256, shot.file);
const contactLabels = ['auto-default', 'orientation-draft', 'request-not-geometry', 'observed-after-window-event', 'retake-all-confirm', 'new-set-review', 'native-capture-promise-held', 'previous-set-restored', 'ready-with-abandoned-original-private'];
const contacts = [];
for (const orientation of ['portrait', 'landscape']) {
  const shots = contactLabels.map(label => report.screenshots.find(shot => shot.orientation === orientation && shot.label === label));
  assert.ok(shots.every(Boolean));
  const file = `${root}/orientation-retake-${orientation}-contact.png`;
  execFileSync('python3', ['-c', `
import json,sys
from PIL import Image,ImageDraw
shots=json.loads(sys.argv[1]); orientation=sys.argv[2]; file=sys.argv[3]
w,h=390,(600 if orientation=='portrait' else 330)
canvas=Image.new('RGB',(w*3,h*3),'#eae6dc');draw=ImageDraw.Draw(canvas)
for i,shot in enumerate(shots):
 x,y=i%3*w,i//3*h
 im=Image.open(shot['file']).convert('RGB'); im.thumbnail((w-16,h-40));canvas.paste(im,(x+(w-im.width)//2,y+8))
 draw.text((x+6,y+h-24),shot['label'],fill='#243a2b')
canvas.save(file)
`, JSON.stringify(shots), orientation, file]);
  contacts.push({ orientation, file, sha256: hash(await readFile(file)), scope: 'Scaled contact sheet of nine unchanged settled actual-JSX screenshots.' });
}
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cards = report.screenshots.map(shot => `<figure><a href="${escape(path.basename(shot.file))}"><img loading="lazy" src="${escape(path.basename(shot.file))}" alt="${escape(shot.label)}"></a><figcaption>${escape(shot.label)} · began ${escape(shot.orientation)} · actual ${shot.width}×${shot.height}</figcaption></figure>`).join('\n');
await writeFile(`${root}/orientation-retake-index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orientation & whole-set retakes · actual-JSX synthetic evidence</title><style>body{max-width:1500px;margin:28px auto;padding:0 20px;background:#f6f1e7;color:#26392a;font:16px/1.5 system-ui}h1{font:42px Georgia,serif}p{max-width:100ch}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}figure{margin:0}img{width:100%;height:540px;object-fit:contain;object-position:top;background:#e8e4da}figcaption{padding:8px 0}a{color:inherit}</style><h1>Orientation & whole-set retakes</h1><p>${report.checks.length} focused actual-Root groups passed in both starting orientations. ${report.screenshots.length} settled screenshots and two independent QR decoders per orientation. Existing generated drink-free fixtures; no real guest photos, credentials or messages.</p><p><strong>Browser fixture, not iPad proof.</strong> A fulfilled synthetic lock is kept separate from native orientation and actual browser-window geometry. The actual production orientation controller and capture runner execute against explicit native ports. Synthetic preference persistence uses sessionStorage, not Keychain. Native rotation, real capture, Photos, durable restart, VoiceOver and live sharing remain separate checks.</p><p><a href="orientation-retake-checks.json">Detailed checks</a> · <a href="orientation-retake-evidence.json">Manifest</a> · <a href="orientation-retake-sha256.txt">SHA256 inventory</a></p><main>${cards}</main>\n`);
await writeFile(`${root}/orientation-retake-visual-review.md`, `# Orientation and whole-set retake review\n\n${report.checks.length} focused actual-Root groups pass in portrait and landscape, with ${report.screenshots.length} screenshots and two contact sheets. The actual orientation controller, capture runner, template editor and ready-page classifier execute against explicit synthetic ports.\n\nOrientation changes remain drafts until a fresh OS-authenticated Save. Cancel creates no preference write or native request. Synthetic preference reload restores the committed value. A fulfilled lock alone is not labeled as observed rotation: the current native orientation and window must agree. Unavailable, unsupported and rejected ports never show success. A late-loading orientation port waits through capture, OS authentication or an active photo editor.\n\nBlocked native support and request promises reach the actual five-second controller deadline under a virtual clock. Start becomes available with an error; the original operation remains owned, and its late result cannot create overlapping requests or claim observed success. This does not prove that an actual OS request can be cancelled or prevent a later physical rotation.\n\nWhole-set retakes keep the parent and create distinct child identities. Dialog cancellation/background creates no child. Returning during a countdown cancels it without a late exposure. Four new originals follow a five-second preparation and three-second rhythm; partial sessions need fresh camera readiness and the preparation countdown again. A pending native capture promise and a pending save each prevent abandonment. Returning after preservation retains the abandoned child's original while restoring the complete parent. Legacy five-photo sessions remain five-photo sessions.\n\nOnly the explicitly kept parent uploads. Abandoned child originals never become guest upload assets. No QR appears before complete session acknowledgement; jsQR and ZXing-C++ independently decode the exact synthetic URL from both full screenshots.\n\nVisual inspection scope: actual rendered screens, selected orientation states, mismatch/error copy, retake confirmation, full-size camera/review, save hold and ready-page presentation. Host settings can scroll vertically in a shorter landscape window. Browser RN-web omits native accessibilityState.checked; selected surfaces are inspected without claiming native radio/VoiceOver verification.\n\nLimits: ${report.scope}\n\nNo real PIN, biometric, guest photo, pairing code, credential, production request, SMS, native Photos or physical-device result is included. Historical evidence packages remain separate and unchanged.\n\nApp SHA256: ${report.sourceSHA256}\n`);
const evidence = { generatedAt: new Date().toISOString(), status: report.status, scope: report.scope,
  groupCount: report.checks.length, screenshotCount: report.screenshots.length, contactSheetCount: contacts.length,
  sourceSHA256: report.sourceSHA256, sourceHashes: report.sourceHashes, fixtureSourceHashes: report.fixtureSourceHashes, toolHashes: report.toolHashes,
  fixtureSourceSet: report.sourceSet, qrChecks: report.qrChecks, contacts, screenshots: report.screenshots,
  noUnexpectedExternalRequests: report.unexpectedExternalRequests.length === 0,
  index: `${root}/orientation-retake-index.html`, review: `${root}/orientation-retake-visual-review.md` };
await writeFile(`${root}/orientation-retake-evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
const files = [...report.screenshots.map(shot => shot.file), ...contacts.map(contact => contact.file), ...['orientation-retake-checks.json', 'orientation-retake-bundle-boundary.json', 'orientation-retake-index.html', 'orientation-retake-visual-review.md', 'orientation-retake-evidence.json'].map(file => `${root}/${file}`)].sort();
await writeFile(`${root}/orientation-retake-sha256.txt`, (await Promise.all(files.map(async file => `${hash(await readFile(file))}  ${file}`))).join('\n') + '\n');
console.log(JSON.stringify({ groups: report.checks.length, screenshots: report.screenshots.length, contacts: contacts.length, sourceFiles: Object.keys(report.sourceHashes).length, inventoryEntries: files.length, evidenceSHA256: hash(await readFile(`${root}/orientation-retake-evidence.json`)), inventorySHA256: hash(await readFile(`${root}/orientation-retake-sha256.txt`)) }));

/** Bounded public synthetic evidence index. Does not touch historical packages. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.argv.includes('--provisional') ? '.cache/host-sharing-provisional' : 'artifacts/visual';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = JSON.parse(await readFile(`${root}/host-sharing-checks.json`));
const boundary = JSON.parse(await readFile(`${root}/host-sharing-bundle-boundary.json`));
assert.equal(report.status, 'passed');
assert.deepEqual(report.sourceHashes, boundary.sourceHashes);
assert.deepEqual(report.fixtureSourceHashes, boundary.fixtureSourceHashes);
for (const [file, sha] of Object.entries(report.sourceHashes)) assert.equal(digest(await readFile(file)), sha, `${file} changed since the actual JSX run`);
for (const [file, sha] of Object.entries(report.fixtureSourceHashes)) assert.equal(digest(await readFile(file)), sha, `${file} changed since the actual JSX run`);
for (const [file, sha] of Object.entries(report.verificationToolHashes)) assert.equal(digest(await readFile(file)), sha, `${file} changed since the actual JSX run`);
for (const shot of report.screenshots) assert.equal(digest(await readFile(shot.file)), shot.sha256, `Screenshot changed: ${shot.file}`);
const contactLabels = ['camera-auth-pending', 'host-success', 'share-auth-error', 'unpaired', 'queued', 'ready-exact-session-ack'];
const contacts = [];
for (const orientation of ['portrait', 'landscape']) {
  const shots = contactLabels.map(label => report.screenshots.find(shot => shot.orientation === orientation && shot.label === label));
  assert.ok(shots.every(Boolean));
  const file = `${root}/host-sharing-${orientation}-contact.png`;
  execFileSync('python3', ['-c', `
import sys,json
from PIL import Image,ImageOps,ImageDraw
shots=json.loads(sys.argv[1]); output=sys.argv[2]
w,h=390,600
canvas=Image.new('RGB',(w*3,h*2),'#eae6dc'); draw=ImageDraw.Draw(canvas)
for i,shot in enumerate(shots):
 x,y=(i%3)*w,(i//3)*h
 im=Image.open(shot['file']).convert('RGB'); im.thumbnail((w-16,h-42))
 canvas.paste(im,(x+(w-im.width)//2,y+8))
 draw.text((x+8,y+h-26),shot['label'],fill='#243a2b')
canvas.save(output)
`, JSON.stringify(shots), file]);
  contacts.push({ orientation, file, sha256: digest(await readFile(file)), scope: 'Six settled actual-JSX screenshots; scaled contact sheet for review only.' });
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cards = report.screenshots.map(shot => `<figure><a href="${escape(path.basename(shot.file))}"><img loading="lazy" src="${escape(path.basename(shot.file))}" alt="${escape(shot.label + ' ' + shot.orientation)}"></a><figcaption>${escape(shot.label)} · ${escape(shot.orientation)} · ${shot.width}×${shot.height}</figcaption></figure>`).join('\n');
await writeFile(`${root}/host-sharing-index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Host access & sharing · synthetic actual-JSX evidence</title><style>body{max-width:1500px;margin:28px auto;padding:0 20px;background:#f6f1e7;color:#26392a;font:16px/1.5 system-ui}h1{font:42px Georgia,serif}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}figure{margin:0}img{width:100%;height:540px;object-fit:contain;object-position:top;background:#e8e4da}figcaption{padding:8px 0}a{color:inherit}p{max-width:95ch}</style><h1>Host access & sharing</h1><p>${report.checks.length} focused actual-JSX groups passed in both orientations. ${report.screenshots.length} settled screenshots; two independent full-frame QR decoders per orientation. Drink-free generated fixtures; no real people, secrets, live URLs or messages.</p><p><strong>Browser fixtures, not iOS verification.</strong> OS authentication, Keychain, camera, storage, Photos, Canvas export and network are explicitly synthetic. Real passcode/biometric behavior, iPad camera, Photos saving, device recovery and live sharing still require separate validation.</p><p><a href="host-sharing-checks.json">Detailed test report</a> · <a href="host-sharing-evidence.json">Evidence manifest</a> · <a href="host-sharing-sha256.txt">SHA256 inventory</a></p><main>${cards}</main>\n`);
const review = `# Host access and sharing review\n\n${report.checks.length} focused groups passed against actual current Root JSX in portrait and landscape. ${report.screenshots.length} settled screenshots, two contact sheets, and two full-frame QR comparisons using both jsQR and ZXing-C++.\n\nHost controls open once only after synthetic OS success and stable foreground; cancel, missing passcode and thrown SDK errors remain visible on welcome, camera, review and sharing. Background/stale results stay locked, redaction survives repeated transitions, and each new opening requires explicit authentication. The guest sharing setup action opens private Setup after that same handshake.\n\nProtected settings saves and retained-original exports obtain a fresh foreground lease. Simulated OS success while inactive creates no preference write or Photos SDK copy. Returning to active completes one intended operation with visible feedback; background revocation creates no write/copy and does not restore stale private UI. Retained takes never become guest selections or upload assets. These are browser SDK-port checks, not native Photos evidence.\n\nMissing pairing, an unreadable saved connection, queued uploads, a failed pass, uploaded-but-unpublished assets, and an acknowledged page have distinct truthful states. A complete four-photo session and actual saved Canvas keepsake are required. No QR appears until all five required assets carry the same valid session acknowledgement. Both full-frame independent decoders recover the exact synthetic URL. Next guests removes it.\n\nVisual review: full-bleed camera remains behind a readable temporary host message; errors are visible outside the locked modal; setup-needed and pending-sharing cards use clear actions; the ready page retains large QR/quiet zone and expiration. Screens use existing generated drink-free scenes.\n\nLimits: ${report.scope}\n\nNo production request, real guest photograph, phone number, PIN, pairing code, credential, live message, real Photos export, native gesture, VoiceOver or actual-iPad claim is included. Historical evidence was not regenerated.\n\nApp SHA256: ${report.sourceSHA256}\n`;
await writeFile(`${root}/host-sharing-visual-review.md`, review);
const evidence = {
  generatedAt: new Date().toISOString(), status: 'passed', scope: report.scope,
  groups: report.checks.length, screenshotCount: report.screenshots.length, contactSheetCount: contacts.length,
  sourceSHA256: report.sourceSHA256, sourceHashes: report.sourceHashes,
  fixtureSourceHashes: report.fixtureSourceHashes,
  verificationToolHashes: report.verificationToolHashes,
  generatedFixtureSourceSet: report.sourceSet, noExternalRequests: true,
  independentQRChecks: report.qrChecks, screenshots: report.screenshots.map(({ layout, ...shot }) => shot), contacts,
  review: `${root}/host-sharing-visual-review.md`, index: `${root}/host-sharing-index.html`,
};
await writeFile(`${root}/host-sharing-evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
const files = [...report.screenshots.map(shot => shot.file), ...contacts.map(contact => contact.file), ...['host-sharing-checks.json', 'host-sharing-bundle-boundary.json', 'host-sharing-index.html', 'host-sharing-visual-review.md', 'host-sharing-evidence.json'].map(file => `${root}/${file}`)].sort();
await writeFile(`${root}/host-sharing-sha256.txt`, (await Promise.all(files.map(async file => `${digest(await readFile(file))}  ${file}`))).join('\n') + '\n');
console.log(JSON.stringify({ groups: report.checks.length, screenshots: report.screenshots.length, contacts: contacts.length, sourceFiles: Object.keys(report.sourceHashes).length, inventoryEntries: files.length, evidenceSHA256: digest(await readFile(`${root}/host-sharing-evidence.json`)), inventorySHA256: digest(await readFile(`${root}/host-sharing-sha256.txt`)) }));

/** UI-only face-picker evidence. No fabricated native accessory output. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
if (process.argv.includes('--help')) { console.log('Usage: node tools/native-visual/new-session/face-effects-build-evidence.mjs [--provisional]\nRequires passing face-effects UI report. --help writes nothing.'); process.exit(0); }
assert.ok(process.argv.slice(2).every(argument => argument === '--provisional'));
const root = process.argv.includes('--provisional') ? '.cache/face-effects-provisional' : 'artifacts/visual';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = JSON.parse(await readFile(`${root}/face-effects-checks.json`));
assert.equal(report.status, 'passed'); assert.equal(report.nativeFaceOutputFixtures, false);
for (const section of ['sourceHashes', 'fixtureSourceHashes', 'nativeSourceHashes', 'toolHashes']) for (const [file, expected] of Object.entries(report[section])) assert.equal(hash(await readFile(file)), expected, file);
for (const shot of report.screenshots) assert.equal(hash(await readFile(shot.file)), shot.sha256, shot.file);
const contacts = [];
const contactLabels = ['none-original', 'synthetic-no-face-glasses', 'synthetic-no-usable-face', 'synthetic-processing-error', 'synthetic-pending-no-accessory-pixels', 'saved-colour-only-cache-copy', 'private-copy-failure', 'jpeg-presentation-failure', 'next-guests-none-default'];
for (const orientation of ['portrait', 'landscape']) {
  const shots = contactLabels.map(label => report.screenshots.find(shot => shot.orientation === orientation && shot.label === label)); assert.ok(shots.every(Boolean));
  const file = `${root}/face-effects-${orientation}-contact.png`;
  execFileSync('python3', ['-c', `
import json,sys
from PIL import Image,ImageDraw
shots=json.loads(sys.argv[1]);orientation=sys.argv[2];filename=sys.argv[3]
w,h=390,(600 if orientation=='portrait' else 330)
im=Image.new('RGB',(w*3,h*3),'#eae6dc');draw=ImageDraw.Draw(im)
for i,s in enumerate(shots):
 x,y=i%3*w,i//3*h;img=Image.open(s['file']).convert('RGB');img.thumbnail((w-16,h-40));im.paste(img,(x+(w-img.width)//2,y+8));draw.text((x+6,y+h-24),s['label'],fill='#243a2b')
im.save(filename)
`, JSON.stringify(shots), orientation, file]);
  contacts.push({ file, orientation, sha256: hash(await readFile(file)) });
}
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cards = report.screenshots.map(shot => `<figure><a href="${escape(path.basename(shot.file))}"><img src="${escape(path.basename(shot.file))}" loading="lazy" alt="${escape(shot.label)}"></a><figcaption>${escape(shot.label)} · ${escape(shot.orientation)}</figcaption></figure>`).join('\n');
await writeFile(`${root}/face-effects-index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accessory picker UI and fault-state evidence</title><style>body{max-width:1500px;margin:28px auto;padding:0 20px;background:#f6f1e7;color:#26392a;font:16px/1.5 system-ui}h1{font:42px Georgia,serif}p{max-width:100ch}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}figure{margin:0}img{width:100%;height:540px;object-fit:contain;object-position:top;background:#e8e4da}figcaption{padding:8px 0}a{color:inherit}</style><h1>Accessory picker UI and fault states</h1><p><strong>These screenshots do not demonstrate native accessory rendering.</strong> They intentionally simulate no-face, unsafe-placement and processing errors, even on fictional portraits with visible faces. No browser face artwork or CSS overlay is used. Original pixels and a clearly labeled colour-only Canvas approximation exercise the actual Root controller and cache-copy flow.</p><p>${report.checks.length} UI groups passed; ${report.screenshots.length} screenshots in portrait and landscape. Native Vision detection, accessory placement, native JPEG quality/metadata, iPad storage, Photos and physical-device behavior require separate verification.</p><p><a href="face-effects-checks.json">Detailed UI report</a> · <a href="face-effects-evidence.json">Manifest</a> · <a href="face-effects-parity-review.md">Read-only parity/recovery audit</a> · <a href="face-effects-sha256.txt">SHA256 inventory</a></p><main>${cards}</main>\n`);
await writeFile(`${root}/face-effects-parity-review.md`, `# Post-capture treatment parity and recovery review\n\nScope: independent read-only source review plus ${report.checks.length} actual-Root UI groups through explicit browser SDK ports. This is not native face-engine or physical-iPad verification.\n\n| Boundary | Inspected behavior | Limit |\n| --- | --- | --- |\n| Preview and Apply | The treatment controller acknowledges one full-resolution cache URI and output hash. Apply copies that URI; it does not render again or substitute a second same-recipe cache. Existing committed variants reopen through their durable URI. | Browser proof uses original/colour-only JPEGs. |\n| Durable selection | New treatment input names the untouched root original and source/output hashes. The repository verifies copied bytes and admission, journals a non-auto-selecting claim, then commits selection separately. | Real files/SQLite tests run in a separate lane; these UI ports are in memory. |\n| Photos | The existing exporter receives the selected canonical file URI. It does not regenerate effects; uncertainty markers still precede non-idempotent Photos writes. | Browser MediaLibrary calls are mocked. |\n| Publication and downloads | Selected derivative IDs feed primary uploads and the keepsake; sourcePhotoId preserves untouched root IDs for original downloads. The server serves private stored bytes by acknowledged gallery role, without a face renderer. | No live R2 upload, download or SMS request was performed here. |\n| Recovery | Treatment claims reserve their IDs and carry selectionEligible=false. Recovery can preserve staged bytes without silently selecting them. Source/output hashes reject mismatched bytes. Existing valid completed queue rows retain their acknowledged state. | Native process death and iPad reboot remain untested. |\n\nThe independent audit identified a legacy .draft.jpg root-path compatibility defect. The persistence owner reproduced it with real files/SQLite and changed same-root-ID JPEG/draft lookup to require the exact recorded source hash, preserving the root path and bytes. Confirm the final production persistence suite separately; this review does not claim it executed those tests.\n\nUI fault coverage includes explicit None, no-face/unsafe-placement fallback, safe processing errors, serial rapid selection/cancellation, exact cache-copy parity, copy failure, JPEG presentation acknowledgement, stale SDK callbacks, revoked background admission, keyboard activation, reduced/normal motion and Next guests reset. No successful accessory pixels or face counts were invented. Native Swift files are fingerprinted for candidate identity only, and were not executed by this browser run.\n\nApp SHA256: ${report.sourceSHA256}\n`);
const evidence = { generatedAt: new Date().toISOString(), scope: report.scope, status: report.status,
  uiGroups: report.checks.length, screenshotCount: report.screenshots.length, nativeFaceOutputFixtures: false,
  sourceSHA256: report.sourceSHA256, sourceHashes: report.sourceHashes, fixtureSourceHashes: report.fixtureSourceHashes,
  nativeSourceHashes: report.nativeSourceHashes, toolHashes: report.toolHashes,
  facePixelScope: report.facePixelScope, screenshots: report.screenshots, contacts,
  index: `${root}/face-effects-index.html`, audit: `${root}/face-effects-parity-review.md` };
await writeFile(`${root}/face-effects-evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
const files = [...report.screenshots.map(shot => shot.file), ...contacts.map(contact => contact.file), ...['face-effects-bundle-boundary.json', 'face-effects-checks.json', 'face-effects-index.html', 'face-effects-parity-review.md', 'face-effects-evidence.json'].map(file => `${root}/${file}`)].sort();
await writeFile(`${root}/face-effects-sha256.txt`, (await Promise.all(files.map(async file => `${hash(await readFile(file))}  ${file}`))).join('\n') + '\n');
console.log(JSON.stringify({ uiGroups: report.checks.length, screenshots: report.screenshots.length, contacts: contacts.length, inventoryEntries: files.length, evidenceSHA256: hash(await readFile(`${root}/face-effects-evidence.json`)), inventorySHA256: hash(await readFile(`${root}/face-effects-sha256.txt`)) }));

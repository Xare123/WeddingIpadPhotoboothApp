import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// Diagnostic output is public. Do not read environment values or credential
// files to discover secrets; redact known sensitive forms from command output.
export function redact(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\/g\/[a-f0-9]{32,}/gi, '/g/[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\+[1-9][0-9]{7,14}\b/g, '[redacted phone]')
    .replace(/([?&](?:token|key|secret|signature)=)[^\s&<>"']+/gi, '$1[redacted]');
}
export function bounded(text, lines = 100, chars = 32_000) {
  return redact(text).split('\n').slice(-lines).join('\n').slice(-chars);
}

export function workflowData(text) {
  return String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

export function annotationText(text, limit = 700) {
  return redact(String(text))
    .replace(/(?:https?|wss?|ftp|file):\/\/[^\s<>"']+/gi, '[redacted URL]')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|app|co|test|invalid)(?:\/[^\s<>"']*)?/gi, '[redacted host]')
    .replace(/\b[a-f0-9]{48,}\b/gi, '[redacted token]')
    .replace(/\+[1-9][\d ().-]{6,30}\d\b/g, '[redacted phone]')
    .replace(/\b(?:token|secret|password|api[_-]?key|authorization)\s*:\s*[^\r\n]*/gi, '[redacted credential]')
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^\r\n]*/g, '[redacted assignment]')
    .replace(/\b[A-Z_][A-Z0-9_]{2,}\s*:\s*[^\r\n]*/g, '[redacted assignment]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, limit);
}

export function diagnosticLines(logs, stages = [], limit = 3) {
  const preferred = stages.filter(stage => stage.result === 'failed').map(stage => stage.name + '.log');
  const metroFailed = stages.some(stage => stage.result === 'failed' && stage.name.startsWith('metro-'));
  if (metroFailed) preferred.push('metro.log');
  const names = [...new Set([...preferred, ...Object.keys(logs).sort()])];
  const selected = [], seen = new Set(), records = [];
  // Select error records, never a dump of build commands or exported variables.
  const errorRecord = /^\s*(?:.*?:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error:\s|^\s*(?:npm (?:ERR!|error)\b|(?:Error(?: \[[A-Z0-9_]+\])?|SyntaxError|TypeError|ReferenceError|RangeError):|fatal:|xcodebuild:\s*error:|Traceback\b|Could not\b|Cannot\b|Unable to\b)|\((?:LoadError|RuntimeError)\)|:\s*(?:command not found|Permission denied|No such file or directory)\s*$/i;
  for (const name of names) {
    const lines = bounded(logs[name] ?? '', 400, 96_000).split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (name === 'ci-contracts.log') {
        if (/^\s*(?:error|message):\s*[|>][+-]?\s*$/.test(line)) {
          const indent = line.search(/\S/), details = [];
          for (const next of lines.slice(index + 1, index + 5)) {
            if (next.trim() && next.search(/\S/) <= indent) break;
            if (next.trim()) details.push(next.trim());
            if (details.length === 2) break;
          }
          if (details.length) records.push({ name, line: 'error: ' + details.join(' '), rank: 0 });
          continue;
        }
        if (/^\s*(?:not ok \d+\b|failureType:\s*\S|message:\s*\S)/.test(line)) {
          records.push({ name, line, rank: 0 });
          continue;
        }
      }
      const cocoa = /^\s*\[!\]/.test(line);
      if (cocoa && /(?:\bwarn(?:ing)?\b|\b(?:has|have) added \d+ script phase|please inspect before executing|please close any current xcode sessions)/i.test(line)) continue;
      const explicit = errorRecord.test(line) || /^\s*(?:ERROR\s|CommandError:)/.test(line) || (cocoa && /\b(?:error|failed|failure|could not|cannot|unable|invalid|incompatible|not found|requires)\b/i.test(line));
      if (explicit || (cocoa && preferred.includes(name))) records.push({ name, line, rank: explicit ? 0 : 2 });
    }
  }
  if (metroFailed) {
    const meaningful = bounded(logs['metro.log'] ?? '', 400, 96_000).split('\n').filter(line =>
      /(?:Starting (?:project|Metro)|Metro (?:is running|Bundler|waiting)|Waiting on|CommandError|error|failed|port.*(?:used|available|busy)|CI mode)/i.test(line));
    for (const line of meaningful.slice(-2)) records.push({ name: 'metro.log', line, rank: 1 });
  }
  records.sort((left, right) => left.rank - right.rank);
  for (const { name, line } of records) {
    const safe = annotationText(line.trim(), 550);
    if (!safe || seen.has(safe)) continue;
    seen.add(safe);
    selected.push(annotationText(basename(name), 80) + ': ' + safe);
    if (selected.length >= limit) return selected;
  }
  return selected;
}

const workflowSteps = new Set(['checkout', 'node-setup', 'bootstrap', 'ci-contracts', 'npm-ci', 'typecheck', 'cocoapods-install', 'native-invocation']);
export function publicAnnotations({ kind = 'native', jobStatus, status, sha, logs = {}, failedStep, nativeMode }) {
  const exactSha = /^[a-f0-9]{40}$/i.test(sha ?? '') ? sha : 'unavailable';
  const title = kind === 'native' ? ((status?.mode ?? nativeMode) === 'release-build' ? 'Unsigned Release iOS diagnostics' : 'Native simulator diagnostics') : 'Linux verification diagnostics';
  const failed = ['failure', 'failed'].includes(jobStatus) || status?.result === 'failed';
  if (failed) {
    const safeStep = workflowSteps.has(failedStep) ? failedStep : undefined;
    const stages = [...(status?.stages ?? [])];
    if (safeStep && !stages.some(stage => stage.result === 'failed')) stages.push({ name: safeStep, result: 'failed' });
    const failures = stages.filter(stage => stage.result === 'failed')
      .map(stage => annotationText(stage.name, 80) + ': failed').slice(0, 3);
    const context = [
      'Commit: ' + exactSha,
      'Failed stage: ' + (failures.join('; ') || 'not reported; consult the diagnostic records'),
      ...(status?.error ? ['Failure: ' + annotationText(status.error)] : []),
      ...diagnosticLines(logs, stages),
    ].join('\n');
    return ['::error title=' + title + '::' + workflowData(context)];
  }
  const succeeded = jobStatus === 'success' || status?.result === 'passed';
  const release = status?.releaseEvidence;
  if (succeeded && kind === 'native' && status?.result === 'passed' && status.mode === 'release-build' &&
    status.nativeBuild === 'passed' && release?.configuration === 'Release' && release.sdk === 'iphoneos' &&
    release.signed === false && release.fixture === 'disabled' && release.bundleBytes > 0 && release.executableBytes > 0 &&
    /^[a-f0-9]{64}$/.test(release.bundleSha256 ?? '')) {
    return ['::notice title=Unsigned Release iOS build evidence::' + workflowData(
      'Commit: ' + exactSha + '; unsigned Release iPhoneOS app compiled; embedded JavaScript and iPad bundle metadata verified. No XCTest executed; no signing, installation or device testing.')];
  }
  if (succeeded && kind === 'native' && status?.result === 'passed' && status.mode === 'release-runtime' &&
    status.fixture === 'disabled' && Number.isSafeInteger(status.expectedTestCount) && status.expectedTestCount >= 15 && status.tests?.executed >= status.expectedTestCount && status.tests.failures === 0 && (status.tests.skipped ?? 0) === 0) {
    return ['::notice title=Release simulator runtime evidence::' + workflowData(
      'Commit: ' + exactSha + '; executed XCTest tests: ' + status.tests.executed + '; failures: 0; skipped: 0. Core Image effects/template pixel tests and Release attract launch/relaunch/orientation passed; embedded JavaScript without Metro; fixture disabled. Camera, saving, Photos, signing and physical devices untested.')];
  }
  if (succeeded && kind === 'native' && status?.result === 'passed' && (status.mode === 'ui-tests' || status.mode === undefined) &&
    status.tests?.executed > 0 && status.tests.failures === 0 && (status.tests.skipped ?? 0) === 0) {
    return ['::notice title=Native simulator XCTest evidence::' + workflowData(
      'Commit: ' + exactSha + '; executed XCTest tests: ' + status.tests.executed + '; failures: 0; skipped: 0. Synthetic camera and real native storage; Debug JavaScript supplied by Metro.')];
  }
  if (succeeded && kind === 'linux') return ['::notice title=Linux verification evidence::' + workflowData(
    'Commit: ' + exactSha + '; Linux checks completed. Native XCTest execution is reported by the simulator lane.')];
  return [];
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const kind = process.argv[2] === 'native' ? 'native' : 'linux';
  const directory = process.env.WEDDING_DIAGNOSTICS_DIR ?? join(process.env.RUNNER_TEMP ?? '/tmp', `wedding-${kind}-diagnostics`);
  mkdirSync(directory, { recursive: true });
  const nativeStatus = join(directory, 'status.json');
  let status;
  if (existsSync(nativeStatus)) {
    try { status = JSON.parse(readFileSync(nativeStatus, 'utf8')); } catch { /* Show job status below. */ }
  }
  const nativeMode = status?.mode ?? process.env.WEDDING_NATIVE_MODE;
  // Only these bounded, redacted text files are included in the public summary.
  const files = readdirSync(directory).filter(name => name.endsWith('.log') || name === 'toolchain.txt');
  for (const name of files) {
    const path = join(directory, name);
    writeFileSync(path, bounded(readFileSync(path, 'utf8'), 400, 96_000));
  }
  const summary = [
    '## ' + (kind === 'native' ? (nativeMode === 'release-build' ? 'Unsigned Release iOS build verification' : 'Native iPad simulator verification') : 'Linux verification'),
    '', `Commit: \`${process.env.GITHUB_SHA ?? 'local-validation'}\``,
    `Job result: **${process.env.WEDDING_JOB_STATUS ?? status?.result ?? 'unknown'}**`, '',
  ];
  if (workflowSteps.has(process.env.WEDDING_FAILED_STEP)) summary.push('Failed workflow step: **' + process.env.WEDDING_FAILED_STEP + '**', '');
  if (status) {
    summary.push('| Stage | Result | Seconds |', '| --- | --- | ---: |');
    for (const stage of status.stages ?? []) summary.push(`| ${stage.name} | ${stage.result} | ${stage.seconds ?? ''} |`);
    summary.push('');
    if (status.simulator) summary.push(`Simulator: ${status.simulator.name}; runtime ${status.simulator.runtime}.`, '');
    if (status.expectedTestCount) summary.push('Required XCTest methods: **' + status.expectedTestCount + '**; exact production engine/test source SHA-256 manifest: `runtime-sources.json`.', '');
    if (status.tests) summary.push(`Executed XCTest tests: **${status.tests.executed}**; failures: **${status.tests.failures}**; skipped: **${status.tests.skipped ?? 0}**.`, '');
    if (status.releaseEvidence) summary.push('Release build: **' + status.nativeBuild + '**; SDK: **iphoneos**; embedded JavaScript: **' + status.releaseEvidence.bundleBytes + ' bytes**; SHA-256: ' + status.releaseEvidence.bundleSha256 + '.', '');
    if (status.error) summary.push(`Failure: ${bounded(status.error, 8, 2000).replaceAll('`', "'")}`, '');
  }
  if (kind === 'native' && nativeMode === 'release-build') summary.push(
    'Unsigned Release build with embedded JavaScript and the synthetic fixture disabled. No Metro development server or simulator is used.',
    'This verifies compilation and bundle contents. No XCTest executed; signing, installation and real-device behavior remain unverified.', '',
  );
  else if (kind === 'native' && nativeMode === 'release-runtime') summary.push(
    'Genuine unsigned Release simulator app; embedded JavaScript; fixture explicitly disabled; no Metro development server.',
    'XCTest compiles exact production engines into its own runner namespace and covers Core Image effects/template pixels, fresh attract UI, enabled accessible primary controls, portrait/landscape and app relaunch. Camera capture, photo saving, Photos export, signing and physical iPads remain unverified.', '',
  );
  else if (kind === 'native') summary.push(
    'This unsigned Debug build uses a synthetic camera fixture and real native storage. Metro supplies JavaScript on loopback.',
    'Offline checks cover an unavailable photo API and persistence across app restarts. Standalone offline JavaScript, the physical camera, Apple signing and a real iPad remain untested.', '',
  );
  for (const name of files) {
    summary.push(`<details><summary>${basename(name)}</summary>`, '', '```text',
      bounded(readFileSync(join(directory, name), 'utf8'), 60, 14_000).replaceAll('```', "'''"), '```', '</details>', '');
  }
  writeFileSync(join(directory, 'summary.md'), summary.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n'));
  else process.stdout.write(summary.join('\n'));
  const logs = Object.fromEntries(files.map(name => [name, readFileSync(join(directory, name), 'utf8')]));
  for (const annotation of publicAnnotations({ kind, jobStatus: process.env.WEDDING_JOB_STATUS, failedStep: process.env.WEDDING_FAILED_STEP, nativeMode, status, sha: process.env.GITHUB_SHA, logs })) {
    process.stdout.write(annotation + '\n');
  }
}

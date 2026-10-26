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
  const names = [...new Set([...preferred, ...Object.keys(logs).sort()])];
  const selected = [], seen = new Set(), records = [];
  // Select error records, never a dump of build commands or exported variables.
  const errorRecord = /^\s*(?:.*?:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error:\s|^\s*(?:npm (?:ERR!|error)\b|Error:|fatal:|xcodebuild:\s*error:|Traceback\b|Could not\b|Cannot\b|Unable to\b)|\((?:LoadError|RuntimeError)\)|:\s*(?:command not found|Permission denied|No such file or directory)\s*$/i;
  for (const name of names) {
    for (const line of bounded(logs[name] ?? '', 400, 96_000).split('\n')) {
      const cocoa = /^\s*\[!\]/.test(line);
      if (cocoa && /(?:\bwarn(?:ing)?\b|\b(?:has|have) added \d+ script phase|please inspect before executing)/i.test(line)) continue;
      const explicit = errorRecord.test(line) || (cocoa && /\b(?:error|failed|failure|could not|cannot|unable|invalid|incompatible|not found|requires)\b/i.test(line));
      if (explicit || cocoa) records.push({ name, line, rank: explicit ? 0 : 1 });
    }
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

export function publicAnnotations({ kind = 'native', jobStatus, status, sha, logs = {} }) {
  const exactSha = /^[a-f0-9]{40}$/i.test(sha ?? '') ? sha : 'unavailable';
  const title = kind === 'native' ? 'Native simulator diagnostics' : 'Linux verification diagnostics';
  const failed = ['failure', 'failed'].includes(jobStatus) || status?.result === 'failed';
  if (failed) {
    const stages = status?.stages ?? [];
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
  if (succeeded && kind === 'native' && status?.result === 'passed' &&
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
  // Only these bounded, redacted text files are included in the public summary.
  const files = readdirSync(directory).filter(name => name.endsWith('.log') || name === 'toolchain.txt');
  for (const name of files) {
    const path = join(directory, name);
    writeFileSync(path, bounded(readFileSync(path, 'utf8'), 400, 96_000));
  }
  const summary = [
    `## ${kind === 'native' ? 'Native iPad simulator verification' : 'Linux verification'}`,
    '', `Commit: \`${process.env.GITHUB_SHA ?? 'local-validation'}\``,
    `Job result: **${process.env.WEDDING_JOB_STATUS ?? status?.result ?? 'unknown'}**`, '',
  ];
  if (status) {
    summary.push('| Stage | Result | Seconds |', '| --- | --- | ---: |');
    for (const stage of status.stages ?? []) summary.push(`| ${stage.name} | ${stage.result} | ${stage.seconds ?? ''} |`);
    summary.push('');
    if (status.simulator) summary.push(`Simulator: ${status.simulator.name}; runtime ${status.simulator.runtime}.`, '');
    if (status.tests) summary.push(`Executed XCTest tests: **${status.tests.executed}**; failures: **${status.tests.failures}**; skipped: **${status.tests.skipped ?? 0}**.`, '');
    if (status.error) summary.push(`Failure: ${bounded(status.error, 8, 2000).replaceAll('`', "'")}`, '');
  }
  if (kind === 'native') summary.push(
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
  for (const annotation of publicAnnotations({ kind, jobStatus: process.env.WEDDING_JOB_STATUS, status, sha: process.env.GITHUB_SHA, logs })) {
    process.stdout.write(annotation + '\n');
  }
}

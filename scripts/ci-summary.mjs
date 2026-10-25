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
}

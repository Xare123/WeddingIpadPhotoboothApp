import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bounded, redact } from './ci-summary.mjs';
import { passingXCTestCounts, selectIpadSimulator } from './ci-native-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const diagnostics = process.env.WEDDING_DIAGNOSTICS_DIR ?? join(process.env.RUNNER_TEMP ?? '/tmp', 'wedding-native-diagnostics');
const derived = join(process.env.RUNNER_TEMP ?? '/tmp', 'wedding-native-derived');
const resultBundle = join(diagnostics, 'native-tests.xcresult');
const status = { result: 'running', stages: [], fixture: 'synthetic-camera-real-native-storage' };
mkdirSync(diagnostics, { recursive: true });
const saveStatus = () => writeFileSync(join(diagnostics, 'status.json'), JSON.stringify(status, null, 2));
let metro, simulator, createdHere = false, bootedHere = false;
const children = new Set();
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    status.result = 'cancelled'; status.error = `Runner received ${signal}`; saveStatus();
    for (const child of [...children, ...(metro ? [metro] : [])]) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    }
    if (simulator && createdHere) {
      spawnSync('xcrun', ['simctl', 'shutdown', simulator.udid], { timeout: 3000, stdio: 'ignore' });
      spawnSync('xcrun', ['simctl', 'delete', simulator.udid], { timeout: 3000, stdio: 'ignore' });
    }
    process.exit(code);
  });
}
// No credentials are required by the public native test. Avoid propagating
// token/secret variables into native build scripts or XCTest result bundles.
const fixtureEnv = { ...process.env, EXPO_PUBLIC_E2E_FIXTURE: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', COCOAPODS_DISABLE_STATS: 'true' };
for (const name of Object.keys(fixtureEnv)) if (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY/i.test(name)) delete fixtureEnv[name];

function command(name, binary, args, { cwd = root, timeout = 180_000, allowFailure = false, env = fixtureEnv } = {}) {
  return new Promise((resolveCommand, reject) => {
    const started = Date.now();
    const entry = { name, result: 'running' };
    status.stages.push(entry); saveStatus();
    const lines = [];
    let pending = '', timedOut = false;
    const child = spawn(binary, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const collect = chunk => {
      pending += chunk.toString();
      const complete = pending.split('\n'); pending = complete.pop().slice(-32_000);
      for (const line of complete) {
        const safe = redact(line).slice(-16_000);
        lines.push(safe);
        if (lines.length > 1200) lines.shift();
        process.stdout.write(`${safe}\n`);
      }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000).unref();
    }, timeout);
    child.on('error', error => { pending += error.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer); children.delete(child);
      if (pending) lines.push(redact(pending));
      const output = bounded(lines.join('\n'), 1200, 200_000);
      writeFileSync(join(diagnostics, `${name}.log`), output);
      entry.result = code === 0 && !timedOut ? 'passed' : allowFailure ? 'unavailable' : 'failed';
      entry.seconds = Math.round((Date.now() - started) / 1000);
      entry.exitCode = code; entry.signal = signal; saveStatus();
      if ((code !== 0 || timedOut) && !allowFailure) reject(new Error(`${name} ${timedOut ? 'timed out' : `failed (exit ${code ?? signal})`}`));
      else resolveCommand({ output, code });
    });
  });
}
async function cleanup() {
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  if (metro) {
    try { process.kill(-metro.pid, 'SIGTERM'); } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
    try { process.kill(-metro.pid, 'SIGKILL'); } catch {}
  }
  if (simulator && createdHere) {
    if (bootedHere) await command('simulator-shutdown', 'xcrun', ['simctl', 'shutdown', simulator.udid], { timeout: 30_000, allowFailure: true });
    await command('simulator-delete', 'xcrun', ['simctl', 'delete', simulator.udid], { timeout: 30_000, allowFailure: true });
  }
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('Native verification requires the standard macOS runner');
  const tools = await command('toolchain', 'xcodebuild', ['-version']);
  writeFileSync(join(diagnostics, 'toolchain.txt'), `Node ${process.version}\n${tools.output}\n`);
  await command('prebuild', 'npx', ['--no-install', 'expo', 'prebuild', '--platform', 'ios', '--no-install'], { cwd: join(root, 'apps/ipad') });
  if (!existsSync(join(root, 'scripts/prepare-ios-tests.mjs'))) throw new Error('Native UI test preparation script is missing; tests were not run');
  await command('prepare-tests', process.execPath, ['scripts/prepare-ios-tests.mjs']);
  await command('pods', 'pod', ['_1.16.2_', 'install', '--project-directory=ios'], { cwd: join(root, 'apps/ipad'), timeout: 600_000 });
  const planPath = join(root, 'apps/ipad/ios/native-test-plan.json');
  if (!existsSync(planPath)) throw new Error('Native UI test plan was not generated');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  if (plan.scheme !== 'WeddingPhotoboothNativeTests' || plan.configuration !== 'Debug') throw new Error('Unexpected native UI test plan');
  const workspace = isAbsolute(plan.workspace) ? plan.workspace : resolve(root, plan.workspace);
  if (!workspace.startsWith(join(root, 'apps/ipad/ios/')) || !existsSync(workspace)) throw new Error('Native test workspace is outside the generated project or missing');
  const deviceOutput = await command('simulator-list', 'xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
  const devices = JSON.parse(deviceOutput.output).devices;
  const template = selectIpadSimulator(devices);
  let deviceType = template.deviceTypeIdentifier;
  if (!deviceType) {
    const types = await command('simulator-types', 'xcrun', ['simctl', 'list', 'devicetypes', '--json']);
    deviceType = JSON.parse(types.output).devicetypes.find(type => type.name === template.name)?.identifier;
  }
  if (!deviceType) throw new Error('The selected iPad simulator has no device type');
  const created = await command('simulator-create', 'xcrun', ['simctl', 'create', `Wedding-CI-${process.env.GITHUB_RUN_ID ?? Date.now()}`, deviceType, template.runtime]);
  const udid = created.output.trim();
  if (!/^[0-9a-f-]{36}$/i.test(udid)) throw new Error('simctl did not return a new simulator UUID');
  simulator = { ...template, name: `Wedding CI (${template.name})`, udid }; createdHere = true;
  status.simulator = { name: simulator.name, runtime: simulator.runtime, udid: simulator.udid }; saveStatus();
  await command('simulator-boot', 'xcrun', ['simctl', 'boot', simulator.udid]); bootedHere = true;
  await command('simulator-ready', 'xcrun', ['simctl', 'bootstatus', simulator.udid, '-b']);
  const metroLog = [];
  metro = spawn('npx', ['--no-install', 'expo', 'start', '--localhost', '--port', '8081'], {
    cwd: join(root, 'apps/ipad'), env: fixtureEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const metroOutput = data => {
    metroLog.push(redact(data.toString()));
    if (metroLog.length > 100) metroLog.shift();
    writeFileSync(join(diagnostics, 'metro.log'), bounded(metroLog.join(''), 400, 96_000));
  };
  metro.stdout.on('data', metroOutput); metro.stderr.on('data', metroOutput);
  metro.on('error', error => metroOutput(Buffer.from(error.message)));
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch('http://localhost:8081/status', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.text()).includes('packager-status:running')) { ready = true; break; }
    } catch { /* Bounded startup polling. */ }
    if (metro.exitCode !== null) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  if (!ready) throw new Error('Metro did not become ready on loopback port 8081');
  const test = await command('xcode-test', 'xcodebuild', [
    '-workspace', workspace, '-scheme', plan.scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator',
    '-destination', `platform=iOS Simulator,id=${simulator.udid}`, '-derivedDataPath', derived,
    '-resultBundlePath', resultBundle, '-parallel-testing-enabled', 'NO', '-jobs', '3',
    '-test-timeouts-enabled', 'YES', '-default-test-execution-time-allowance', '180',
    '-maximum-test-execution-time-allowance', '300', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'test',
  ], { timeout: 1_500_000 });
  status.tests = passingXCTestCounts(test.output);
  status.result = 'passed';
}
try { await main(); }
catch (error) { status.result = 'failed'; status.error = redact(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
finally { await cleanup(); saveStatus(); }

// Publish only the exact, clean main frontend commit. Never force-reset work.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const branch = 'main';
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} failed. Deployment stopped.`);
  }
  return result.stdout?.trim();
}
try {
  if (run('git', ['status', '--porcelain'], true)) throw new Error('Uncommitted changes exist. Commit and merge them into the main frontend before publishing.');
  run('git', ['fetch', 'origin', branch]);
  const head = run('git', ['rev-parse', 'HEAD'], true);
  const shared = run('git', ['rev-parse', 'FETCH_HEAD'], true);
  if (head !== shared) throw new Error(`This checkout is not the latest main frontend. Merge your PR into ${branch}, then update this checkout before publishing. No files were reset.`);
  console.log(`Verified main frontend ${head.slice(0, 12)}.`);
  run('npm', ['test']);
  if (process.argv.includes('--check')) console.log('Deployment checks passed; no deployment requested.');
  else run('npx', ['--yes', 'vercel', '--prod', '--yes', ...process.argv.slice(2)]);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
execFileSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'build'], { stdio: 'inherit' });
if (process.platform === 'darwin') {
  execFileSync('ditto', ['src-tauri/target/release/bundle/macos/pure-point.app', 'pure-point.app']);
  execFileSync('codesign', ['--force', '--sign', '-', 'pure-point.app']);
}

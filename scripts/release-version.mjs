import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const read = (path) => readFileSync(path, 'utf8');
const base = JSON.parse(read('package.json')).version;
if (!/^\d+\.\d+\.\d+$/.test(base)) throw Error('Expected a numeric base version');
const start = git('log', '--first-parent', '-1', '--format=%H', '-G', '^  "version":', '--', 'package.json');
if (!start) throw Error('Missing base version commit');
const distance = Number(git('rev-list', '--first-parent', '--count', start + '..HEAD'));
const [major, minor, patch] = base.split('.');
const version = [major, minor, Number(patch) + distance].join('.');
for (const path of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
  const data = JSON.parse(read(path));
  data.version = version;
  if (path === 'package-lock.json') data.packages[''].version = version;
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
for (const path of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
  const data = read(path);
  const record = 'name = "pure-point"\nversion = "' + base + '"';
  if (!data.includes(record)) throw Error('Unexpected app version in ' + path);
  writeFileSync(path, data.replace(record, 'name = "pure-point"\nversion = "' + version + '"'));
}
console.log('Building v' + version);
appendFileSync(process.env.GITHUB_OUTPUT, 'tag=v' + version + '\ncommit=' + git('rev-parse', 'HEAD') + '\n');

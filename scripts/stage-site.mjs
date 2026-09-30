import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { mkdir, rm, cp, readdir } from 'node:fs/promises';
await rm('.site-public', { recursive: true, force: true });
await mkdir('.site-public/editor', { recursive: true });
for (const entry of await readdir('.', { withFileTypes: true })) {
  if (entry.isFile() && /\.(html|css|js|svg)$/.test(entry.name) && !entry.name.startsWith('vite.')) await cp(entry.name, `.site-public/${entry.name}`);
}
for (const file of new Set([...execFileSync('git', ['ls-files', 'assets'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean), 'assets/og.png'])) {
  await mkdir(dirname('.site-public/' + file), { recursive: true });
  await cp(file, '.site-public/' + file);
}
for (const file of ['editor.html', 'editor.js', 'editor.css', 'article.css', 'article.js']) {
  await cp(`cloud/${file}`, `.site-public/editor/${file === 'editor.html' ? 'index.html' : file}`);
}

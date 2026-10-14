import { mkdir, cp, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'src']) await cp(file, `dist/${file}`, { recursive: true });
console.log('Built standalone application in dist/');

import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIcons } from './icons.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'extension');
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const buildOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['firefox128'],
  legalComments: 'none',
  sourcemap: false,
  minify: false,
  treeShaking: true,
  logLevel: 'warning',
  loader: { '.css': 'text' },
  banner: {
    js: '/* WhyChess — GPL-3.0-only. Bundled third-party notices: THIRD-PARTY-NOTICES.txt */',
  },
};

const entries = [
  {
    ...buildOptions,
    entryPoints: [path.join(root, 'src/background.js')],
    outfile: path.join(outDir, 'background.js'),
  },
  {
    ...buildOptions,
    entryPoints: [path.join(root, 'src/content/content.js')],
    outfile: path.join(outDir, 'content.js'),
  },
  {
    ...buildOptions,
    entryPoints: [path.join(root, 'src/options/options.js')],
    outfile: path.join(outDir, 'options.js'),
  },
];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await copyAssets();
await buildEntries();

if (watch) {
  console.log(`\nWhyChess: сборка в ${path.relative(root, outDir)}. Ждём изменений…`);
} else {
  await validate();
  await report();
}

async function buildEntries() {
  if (watch) {
    const contexts = await Promise.all(entries.map((options) => context(options)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    return;
  }
  await Promise.all(entries.map((options) => build(options)));
}

async function copyAssets() {
  const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  await copy(path.join(root, 'vendor/stockfish.asm.js'), path.join(outDir, 'stockfish.asm.js'));
  await copy(path.join(root, 'src/options/options.html'), path.join(outDir, 'options.html'));
  await copy(path.join(root, 'src/options/options.css'), path.join(outDir, 'options.css'));
  await copy(path.join(root, 'THIRD-PARTY-NOTICES.txt'), path.join(outDir, 'THIRD-PARTY-NOTICES.txt'));
  await copy(path.join(root, 'LICENSE'), path.join(outDir, 'licenses/GPL-3.0.txt'));
  await copy(
    path.join(root, 'vendor/STOCKFISH-LICENSE.txt'),
    path.join(outDir, 'licenses/STOCKFISH-LICENSE.txt'),
  );
  await copy(
    path.join(root, 'node_modules/chess.js/LICENSE'),
    path.join(outDir, 'licenses/CHESS-JS-LICENSE.txt'),
  );

  const iconsDir = path.join(outDir, 'icons');
  await mkdir(iconsDir, { recursive: true });
  for (const icon of generateIcons(iconsDir)) {
    await writeFile(path.join(iconsDir, `icon-${icon.size}.png`), icon.png);
  }
}

async function copy(from, to) {
  if (!existsSync(from)) throw new Error(`Не найден файл для сборки: ${path.relative(root, from)}`);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function validate() {
  const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  const refs = new Set([
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.background?.scripts || []),
    ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
    manifest.options_ui?.page,
  ]);
  const missing = [];
  for (const ref of refs) {
    if (!ref) continue;
    if (!existsSync(path.join(outDir, ref))) missing.push(ref);
  }
  if (missing.length > 0) {
    throw new Error(`Манифест ссылается на отсутствующие файлы: ${missing.join(', ')}`);
  }
  if (manifest.description.length > 132) {
    throw new Error('Описание в манифесте длиннее 132 символов.');
  }
}

async function report() {
  const files = [
    'manifest.json',
    'background.js',
    'content.js',
    'options.html',
    'options.js',
    'options.css',
    'stockfish.asm.js',
  ];
  console.log(`\nWhyChess ${pkg.version} собран в ${path.relative(root, outDir)}\\`);
  for (const file of files) {
    const info = await stat(path.join(outDir, file));
    console.log(`  ${file.padEnd(18)} ${(info.size / 1024).toFixed(1)} КБ`);
  }
  console.log('\nЗагрузите extension/manifest.json через about:debugging → «Загрузить временное дополнение».');
}

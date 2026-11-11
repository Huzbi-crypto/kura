// package.mjs — build the Chrome Web Store upload zip.
// usage: node tools/package.mjs   ->   dist/kura-<version>.zip
// Only the files the browser needs are included: manifest, src, popup, icons.
// tools/, docs/, worker/ and repo metadata stay out of the package.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const outDir = join(root, 'dist');
const out = join(outDir, `kura-${pkg.version}.zip`);
mkdirSync(outDir, { recursive: true });
if (existsSync(out)) rmSync(out);

const INCLUDE = ['manifest.json', 'src', 'popup', 'icons'];
const py = `
import sys, zipfile, os
root, out = sys.argv[1], sys.argv[2]
inc = sys.argv[3:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for item in inc:
        p = os.path.join(root, item)
        if os.path.isfile(p):
            z.write(p, item)
            continue
        for dirpath, _, names in os.walk(p):
            for n in names:
                full = os.path.join(dirpath, n)
                z.write(full, os.path.relpath(full, root))
print(os.path.getsize(out))
`;
const size = execFileSync('python', ['-c', py, root, out, ...INCLUDE], { encoding: 'utf8' }).trim();
console.log(`built ${out} (${(Number(size) / 1024).toFixed(1)} KiB) v${pkg.version}`);

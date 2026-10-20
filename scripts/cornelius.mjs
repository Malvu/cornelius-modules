/**
 * Les outils de ce dépôt viennent de Cornelius : rien à installer ici. Cornelius est
 * cherché dans CORNELIUS_DIR, sinon dans le dossier voisin ../cornelius, où `npm ci`
 * doit avoir été lancé.
 *
 *   node scripts/cornelius.mjs test | check | format | format:check
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cornelius = resolve(process.env.CORNELIUS_DIR || join(repository, '..', 'cornelius'));
const tool = (path) => join(cornelius, 'node_modules', ...path.split('/'));

if (!existsSync(join(cornelius, 'server', 'addons', 'testing.ts'))) {
  console.error(`Cornelius introuvable dans ${cornelius}.`);
  console.error('Clonez-le à côté de ce dépôt, ou indiquez son dossier dans CORNELIUS_DIR.');
  console.error(
    'Une version qui gère les modules externes (alias #cornelius/testing) est requise.',
  );
  process.exit(1);
}
if (!existsSync(tool('tsx'))) {
  console.error(`Dépendances de Cornelius absentes : lancez « npm ci » dans ${cornelius}.`);
  process.exit(1);
}

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    // Le Cornelius qui teste charge ce dépôt, pas celui de son propre réglage.
    env: { ...process.env, CORNELIUS_MODULES_DIR: repository },
  });
  return result.status ?? 1;
}

/**
 * tsconfig.json suppose Cornelius dans ../cornelius (c'est aussi ce que lit l'éditeur).
 * Ailleurs, une configuration temporaire reprend la même avec les bons chemins.
 */
function typecheck() {
  if (resolve(join(repository, '..', 'cornelius')) === cornelius)
    return run([tool('typescript/bin/tsc'), '-p', join(repository, 'tsconfig.json')], repository);
  // Les motifs de tsconfig veulent des barres obliques, y compris sous Windows.
  const path = (...parts) =>
    join(...parts)
      .split(sep)
      .join('/');
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-modules-'));
  const config = join(directory, 'tsconfig.json');
  writeFileSync(
    config,
    JSON.stringify({
      extends: path(repository, 'tsconfig.json'),
      compilerOptions: {
        typeRoots: [path(cornelius, 'node_modules', '@types')],
        paths: {
          '#cornelius/addons': [path(cornelius, 'shared', 'addons.ts')],
          '#cornelius/validation': [path(cornelius, 'shared', 'validation.ts')],
          '#cornelius/testing': [path(cornelius, 'server', 'addons', 'testing.ts')],
        },
      },
      include: [path(repository, '*', '**', '*.ts')],
      exclude: [path(repository, 'node_modules')],
    }),
  );
  try {
    return run([tool('typescript/bin/tsc'), '-p', config], repository);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const prettier = (mode) =>
  run(
    [tool('prettier/bin/prettier.cjs'), mode, '*/**/*.{ts,json}', '*.json', 'scripts/*.mjs'],
    repository,
  );

const commands = {
  test: () => run(['--import', 'tsx', 'scripts/test-modules.ts'], cornelius),
  check: typecheck,
  format: () => prettier('--write'),
  'format:check': () => prettier('--check'),
};

const command = commands[process.argv[2]];
if (!command) {
  console.error(`Commande inconnue. Attendu : ${Object.keys(commands).join(', ')}.`);
  process.exit(1);
}
process.exit(command());

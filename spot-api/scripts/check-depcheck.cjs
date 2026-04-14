const { spawnSync } = require('node:child_process');

const result = spawnSync(
  'npx',
  [
    'depcheck',
    '.',
    '--json',
    '--ignore-dirs=dist,prisma/migrations',
  ],
  { encoding: 'utf8' },
);

const payload = result.stdout || result.stderr || '{}';

let report;
try {
  report = JSON.parse(payload);
} catch (error) {
  console.error('depcheck output inválido:');
  console.error(payload);
  throw error;
}

const allowUnusedDependencies = new Set(['@polkadot/keyring']);
const allowUnusedDevDependencies = new Set([
  '@types/jest',
  '@types/supertest',
  'depcheck',
  'pino-pretty',
  'ts-prune',
]);
const allowMissingDependencies = new Set();

const unusedDependencies = (report.dependencies || []).filter(
  (name) => !allowUnusedDependencies.has(name),
);
const unusedDevDependencies = (report.devDependencies || []).filter(
  (name) => !allowUnusedDevDependencies.has(name),
);
const missingDependencies = Object.keys(report.missing || {}).filter(
  (name) => !allowMissingDependencies.has(name),
);

if (
  unusedDependencies.length > 0 ||
  unusedDevDependencies.length > 0 ||
  missingDependencies.length > 0
) {
  console.error('depcheck encontrou problemas:');
  if (unusedDependencies.length > 0) {
    console.error('- dependencies não usadas:', unusedDependencies.join(', '));
  }
  if (unusedDevDependencies.length > 0) {
    console.error(
      '- devDependencies não usadas:',
      unusedDevDependencies.join(', '),
    );
  }
  if (missingDependencies.length > 0) {
    console.error('- dependencies faltantes:', missingDependencies.join(', '));
  }
  process.exit(1);
}

console.log('depcheck: nenhuma dependência morta/faltante (após filtros).');

const { execSync } = require('node:child_process');

const rawOutput = execSync('npx ts-prune -p tsconfig.json', {
  encoding: 'utf8',
});

const findings = rawOutput
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.includes('(used in module)'))
  .filter((line) => !/^src\/index\.ts:\d+ - default$/.test(line));

if (findings.length > 0) {
  console.error('ts-prune encontrou exports não utilizados:');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log('ts-prune: nenhum export morto encontrado (após filtros).');

const { execSync } = require('node:child_process');

const output = execSync('npx ts-prune -p tsconfig.json', {
  encoding: 'utf8',
});

const allowExact = new Set([
  'src/config/contracts.ts:34 - TokenMeta',
  'src/hooks/useAnimatedCounter.ts:18 - useAnimatedCounter',
  'src/hooks/useAnimatedCounter.ts:75 - useFlashOnChange',
  'src/sdk/AsymmetricClient.ts:104 - AsymmetricClient',
]);

const findings = output
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.includes('(used in module)'))
  .filter((line) => !line.endsWith(' - default'))
  .filter((line) => !line.startsWith('src/pages/'))
  .filter((line) => !line.startsWith('src/components/'))
  .filter((line) => !line.includes('/styles.ts:'))
  .filter((line) => !line.startsWith('src/styles/motion.ts:'))
  .filter((line) => !allowExact.has(line));

if (findings.length > 0) {
  console.error('ts-prune encontrou exports não utilizados no frontend:');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log('ts-prune: nenhum export morto encontrado no frontend (após filtros).');

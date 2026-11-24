import fs from 'node:fs';
const needed = [
  'dist/script.js', 'dist/api-config.js',
  'gestion/package.json', 'gestion/src/features/store/landing-adapter.ts',
  'gestion/src/app/api/v1/public/products/route.ts',
  'gestion/src/lib/auth/routes.ts', 'gestion/db/migrations/019_store_schema.sql',
];
let ok = true;
for (const file of needed) {
  const exists = fs.existsSync(file);
  console.log(`${exists ? 'OK' : 'FALTA'} ${file}`);
  if (!exists) ok = false;
}
const js = fs.existsSync('dist/script.js') ? fs.readFileSync('dist/script.js','utf8') : '';
if (!js.includes('NOVA_BELLA_TEAM_INTEGRATION_V1')) { console.error('FALTA aplicar node tools/apply-landing-integration.mjs'); ok = false; }
const config = fs.existsSync('dist/api-config.js') ? fs.readFileSync('dist/api-config.js','utf8') : '';
if (/NOVA_BELLA_API_URL\s*=\s*['"]\s*['"]/.test(config)) console.log('PENDIENTE configurar URL HTTPS de gestión para la landing publicada.');
process.exitCode = ok ? 0 : 1;

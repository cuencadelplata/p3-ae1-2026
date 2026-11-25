import { readFileSync, writeFileSync } from 'node:fs';
const parse = (text) => Object.fromEntries(text.split(/\r?\n/).filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => { const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1).trim()]; }));
const source = parse(readFileSync(new URL('../../modulo7/.env', import.meta.url), 'utf8'));
const target = new URL('./.env', import.meta.url);
const values = parse(readFileSync(target, 'utf8'));
for (const [from,to] of Object.entries({SUPABASE_URL:'M7_SUPABASE_URL',SUPABASE_KEY:'M7_SUPABASE_KEY',MP_ACCESS_TOKEN:'MP_ACCESS_TOKEN',MP_PUBLIC_KEY:'MP_PUBLIC_KEY'})) {
  if (!source[from]) throw new Error(`Falta ${from} en modulo7/.env`);
  values[to]=source[from];
}
writeFileSync(target,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
console.log('Configuracion privada de M7 importada sin mostrar valores.');

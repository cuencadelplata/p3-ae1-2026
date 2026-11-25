import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const parse=p=>existsSync(p)?Object.fromEntries(readFileSync(p,'utf8').split(/\r?\n/).filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim()]})):{};
const local=parse('.env'),aws=parse('deployment/aws/.env'),m7=parse('modulo7/.env');
for(const [from,to] of Object.entries({SUPABASE_URL:'M7_SUPABASE_URL',SUPABASE_KEY:'M7_SUPABASE_KEY',MP_ACCESS_TOKEN:'MP_ACCESS_TOKEN',MP_PUBLIC_KEY:'MP_PUBLIC_KEY',DATABASE_URL:'M7_DATABASE_URL'})){
 if(m7[from])local[to]=m7[from];
 if(from!=='DATABASE_URL' && m7[from] && (!aws[to] || /placeholder|invalid/.test(aws[to])))aws[to]=m7[from];
}
// Las credenciales activas tienen prioridad; no cambiar passwords de motores.
for(const key of ['M8_SMTP_HOST','M8_SMTP_PORT','M8_SMTP_USER','M8_SMTP_PASSWORD','M8_MAIL_FROM','GRAFANA_CLOUD_REMOTE_WRITE_URL','GRAFANA_CLOUD_USER','GRAFANA_CLOUD_TOKEN','M3_SUPABASE_URL','M3_SUPABASE_SERVICE_ROLE_KEY'])if(!local[key]&&aws[key])local[key]=aws[key];
local.M1_JWT_SECRET ||= local.JWT_SECRET;
local.JWT_SECRET=local.M1_JWT_SECRET;
local.MP_PUBLIC_KEY=local.MP_PUBLIC_KEY?.replace(/^MP_PUBLIC_KEY=/,'')||'';
for(const [path,data] of [['.env',local],['deployment/aws/.env',aws]])writeFileSync(path,Object.entries(data).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
console.log('Dos entornos consolidados; credenciales de motores preservadas.');

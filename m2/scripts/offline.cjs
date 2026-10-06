// Sólo Node estándar: no exige npm install ni acceso a Internet para start/load/test.
const {spawnSync}=require('node:child_process');
const {resolve}=require('node:path');
const {existsSync,mkdirSync}=require('node:fs');
const root=resolve(__dirname,'..');
const images=['ae2-rf22:local','postgres:15-alpine','redis:7-alpine','rabbitmq:4-management-alpine'];
const compose=['compose','-f','docker-compose.yml','-f','docker-compose.offline.yml'];
function run(args){console.log('docker '+args.join(' '));const r=spawnSync('docker',args,{cwd:root,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error(`Docker terminó con código ${r.status}`);}
const mode=process.argv[2],archive=resolve(root,process.argv[3]||'offline/ae2-images.tar');
try{
 if(mode==='prepare'){
  if(!existsSync(resolve(root,'.env')))throw Error('Primero ejecutar node scripts/setup.cjs');
  run(['compose','pull','postgres','redis','rabbitmq']);run(['compose','build','api']);
 }else if(mode==='export'){
  mkdirSync(require('node:path').dirname(archive),{recursive:true});run(['image','save','--output',archive,...images]);
 }else if(mode==='load'){
  if(!existsSync(archive))throw Error('No existe '+archive);run(['image','load','--input',archive]);
 }else if(mode==='start'){
  for(const image of images)run(['image','inspect','--format','{{.Id}}',image]);
  run([...compose,'up','--no-build','--pull','never','-d']);
 }else if(mode==='test'){
  // El test corre dentro de la red aislada, sin depender del acceso del host a puertos publicados.
  run([...compose,'exec','-T','-e','TEST_API_URL=http://api:3000','-e','M8_BASE_URL=http://m8:4008','api','node','--test','tests/offline.test.cjs','tests/stack.test.cjs']);
 }else throw Error('Uso: node scripts/offline.cjs prepare|export|load|start|test [archivo.tar]');
}catch(e){console.error(e.message);process.exit(1);}

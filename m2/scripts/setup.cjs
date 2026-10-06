const {randomBytes}=require('node:crypto');
const {writeFileSync,existsSync}=require('node:fs');
if(existsSync('.env')) {console.log('.env ya existe; se conserva.');process.exit(0);}
const db=randomBytes(20).toString('hex'),mq=randomBytes(20).toString('hex');
writeFileSync('.env',`POSTGRES_PASSWORD=${db}\nRABBITMQ_PASSWORD=${mq}\nAUTH_SECRET=${randomBytes(32).toString('hex')}\nINTEGRATION_SECRET=${randomBytes(32).toString('hex')}\nDATABASE_URL=postgresql://m2:${db}@localhost:55432/customerdb?connection_limit=10&connect_timeout=3&pool_timeout=5\nREDIS_HOST=localhost\nREDIS_PORT=56379\nRABBITMQ_URL=amqp://ae2:${mq}@localhost:56729\nM4_BASE_URL=http://localhost:4004\nM6_BASE_URL=http://localhost:4000\nCACHE_TTL_SECONDS=60\n`,{mode:0o600});
console.log('.env creado con claves aleatorias para el entorno local.');

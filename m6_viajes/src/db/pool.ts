import pg from 'pg';

const pool = new pg.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'm6',
    password: process.env.DB_PASSWORD || 'm6pass',
    database: process.env.DB_NAME || 'tripdb',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 3000, // si TripDB está caída, falla rápido en vez de colgarse
});

pool.on('error', (err) => {
    console.error('Error inesperado en el pool de TripDB:', err.message);
});

export default pool;
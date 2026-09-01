import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dataDirectory = path.join(
    process.cwd(),
    "data"
);

fs.mkdirSync(dataDirectory, {
    recursive: true
});

const databasePath = path.join(
    dataDirectory,
    "identity.db"
);

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        rol TEXT NOT NULL CHECK (
            rol IN ('CLIENTE', 'CONDUCTOR', 'OPERADOR')
        ),
        estado TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (
            estado IN ('ACTIVO', 'BLOQUEADO')
        ),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`);

export default db;
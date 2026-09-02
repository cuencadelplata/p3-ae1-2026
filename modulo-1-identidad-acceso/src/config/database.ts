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
        nombre TEXT NOT NULL DEFAULT '',
        apellido TEXT NOT NULL DEFAULT '',
        dni TEXT NOT NULL DEFAULT '',
        telefono TEXT NOT NULL DEFAULT '',
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

const userColumns = db
    .prepare("PRAGMA table_info(usuarios)")
    .all() as { name: string }[];
const existingUserColumns = new Set(
    userColumns.map((column) => column.name)
);

for (const column of ["nombre", "apellido", "dni", "telefono"]) {
    if (!existingUserColumns.has(column)) {
        db.exec(`ALTER TABLE usuarios ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }
}

db.exec(`
    CREATE TABLE IF NOT EXISTS password_recovery_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        used_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS oauth2_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        provider_name TEXT NOT NULL CHECK (
            provider_name IN ('GOOGLE', 'GITHUB', 'MICROSOFT', 'CUSTOM')
        ),
        provider_user_id TEXT NOT NULL,
        provider_email TEXT,
        estado TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (
            estado IN ('ACTIVO', 'DESVINCULADO')
        ),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider_name, provider_user_id),
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
`);

export default db;
CREATE TABLE IF NOT EXISTS viajes (
    id VARCHAR(50) PRIMARY KEY,
    cliente_id VARCHAR(50) NOT NULL,
    conductor_id VARCHAR(50),
    estado VARCHAR(30) NOT NULL,
    origen TEXT NOT NULL,
    destino TEXT NOT NULL,
    codigo_verificacion VARCHAR(100),
    qr_data_url TEXT,
    qr_expires_at TIMESTAMPTZ,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE viajes ALTER COLUMN codigo_verificacion DROP NOT NULL;
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS qr_data_url TEXT;
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMPTZ;
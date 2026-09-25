CREATE TABLE IF NOT EXISTS viajes (
    id VARCHAR(50) PRIMARY KEY,
    cliente_id VARCHAR(50) NOT NULL,
    conductor_id VARCHAR(50),
    estado VARCHAR(30) NOT NULL,
    origen TEXT NOT NULL,
    destino TEXT NOT NULL,
    codigo_verificacion VARCHAR(100) NOT NULL,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT now()
);
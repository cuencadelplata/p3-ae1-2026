-- 1. Creamos el esquema aislado para el Módulo 2 (Clientes)
CREATE SCHEMA IF NOT EXISTS customers;

-- 2. Tabla de Perfiles de Clientes
CREATE TABLE IF NOT EXISTS customers.CustomerProfile (
    customer_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50) NOT NULL,
    preferred_vehicle_type VARCHAR(50) NOT NULL DEFAULT 'auto',
    notification_channel VARCHAR(50) NOT NULL DEFAULT 'email',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVO',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Estado de Cuenta y Bloqueos Administrativos
CREATE TABLE IF NOT EXISTS customers.AccountStatus (
    customer_id VARCHAR(50) PRIMARY KEY REFERENCES customers.CustomerProfile(customer_id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVO',
    reason TEXT NOT NULL DEFAULT 'Perfil verificado y sin infracciones operativas',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Datos iniciales para pruebas locales (Seed Demo Data)
INSERT INTO customers.CustomerProfile (customer_id, name, email, phone, preferred_vehicle_type, notification_channel, status, created_at)
VALUES 
    ('cust_823a7b9c', 'Juan Pérez', 'juan.perez@example.com', '+5493512345678', 'auto', 'email', 'ACTIVO', '2026-08-30T23:00:00Z')
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO customers.AccountStatus (customer_id, status, reason, updated_at)
VALUES 
    ('cust_823a7b9c', 'ACTIVO', 'Perfil verificado y sin infracciones operativas', '2026-08-30T23:00:00Z')
ON CONFLICT (customer_id) DO NOTHING;

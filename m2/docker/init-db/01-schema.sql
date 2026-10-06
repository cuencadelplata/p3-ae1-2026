-- 1. Creamos el esquema aislado para el Módulo 2 (Clientes)
CREATE SCHEMA IF NOT EXISTS customers;

-- 2. Tabla de Perfiles de Clientes
CREATE TABLE IF NOT EXISTS customers.CustomerProfile (
    customer_id VARCHAR(50) PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    preferred_vehicle_type VARCHAR(50) NOT NULL DEFAULT 'auto',
    notification_channel VARCHAR(50) NOT NULL DEFAULT 'email',
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Estado de Cuenta y Bloqueos Administrativos
CREATE TABLE IF NOT EXISTS customers.AccountStatus (
    customer_id VARCHAR(50) PRIMARY KEY REFERENCES customers.CustomerProfile (customer_id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVO' CHECK (
        status IN (
            'ACTIVO',
            'INACTIVO',
            'BLOQUEADO_TEMPORAL',
            'BLOQUEADO_PERMANENTE',
            'EN_REVISIÓN'
        )
    ),
    reason TEXT NOT NULL DEFAULT 'Perfil verificado y sin infracciones operativas',
    -- Origen del bloqueo: AUTOMATICO (por penalizaciones) o MANUAL (por el usuario/admin).
    -- Solo los bloqueos AUTOMATICOS pueden revertirse automáticamente al consultar el estado.
    block_origin VARCHAR(20) CHECK (block_origin IN ('AUTOMATICO', 'MANUAL')),
    updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Prohibición de borrado físico (Soft Delete)
-- Los clientes nunca se eliminan: la baja se registra cambiando su estado
-- (ej. INACTIVO). Estos triggers bloquean DELETE y TRUNCATE a nivel de base de datos.
CREATE OR REPLACE FUNCTION customers.prevent_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'No se permite eliminar registros de %.%: actualice el estado del cliente (ej. INACTIVO)', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_delete_customer_profile ON customers.CustomerProfile;
CREATE TRIGGER no_delete_customer_profile
    BEFORE DELETE ON customers.CustomerProfile
    FOR EACH ROW EXECUTE FUNCTION customers.prevent_delete();

DROP TRIGGER IF EXISTS no_truncate_customer_profile ON customers.CustomerProfile;
CREATE TRIGGER no_truncate_customer_profile
    BEFORE TRUNCATE ON customers.CustomerProfile
    FOR EACH STATEMENT EXECUTE FUNCTION customers.prevent_delete();

DROP TRIGGER IF EXISTS no_delete_account_status ON customers.AccountStatus;
CREATE TRIGGER no_delete_account_status
    BEFORE DELETE ON customers.AccountStatus
    FOR EACH ROW EXECUTE FUNCTION customers.prevent_delete();

DROP TRIGGER IF EXISTS no_truncate_account_status ON customers.AccountStatus;
CREATE TRIGGER no_truncate_account_status
    BEFORE TRUNCATE ON customers.AccountStatus
    FOR EACH STATEMENT EXECUTE FUNCTION customers.prevent_delete();

-- 5. Datos iniciales para pruebas locales (Seed Demo Data)
INSERT INTO
    customers.CustomerProfile (
        customer_id,
        user_id,
        preferred_vehicle_type,
        notification_channel,
        created_at
    )
VALUES (
        'cust_823a7b9c',
        12,
        'auto',
        'email',
        '2026-08-30T23:00:00Z'
    ) ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO
    customers.AccountStatus (
        customer_id,
        status,
        reason,
        updated_at
    )
VALUES (
        'cust_823a7b9c',
        'ACTIVO',
        'Perfil verificado y sin infracciones operativas',
        '2026-08-30T23:00:00Z'
    ) ON CONFLICT (customer_id) DO NOTHING;

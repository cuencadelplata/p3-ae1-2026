-- ==============================================================================
-- DATABASE SCHEMA: CustomerDB (Módulo M2 - Clientes)
-- REQUERIMIENTO: RF-2.4 Calificación del Conductor
-- ==============================================================================
-- Principio de Arquitectura: Aislamiento estricto de datos (Database-per-Service).
-- Este esquema pertenece exclusivamente al dominio de Clientes (M2).
-- Queda prohibida toda clave foránea o consulta cruzada hacia TripDB o DriverDB.
-- ==============================================================================

-- Crear extensión para generación de UUIDs si no existe
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. Tabla de Clientes (Entidad Raíz del Dominio M2)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 2. Tabla de Calificaciones emitidas por el Cliente (RF-2.4)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Cliente emisor (clave foránea interna dentro del mismo esquema CustomerDB)
    customer_id UUID NOT NULL,
    
    -- Referencia al viaje calificado (Identificador externo, sin FK a TripDB)
    trip_id UUID NOT NULL,
    
    -- Referencia al conductor calificado (Identificador externo, sin FK a DriverDB)
    driver_id UUID NOT NULL,
    
    -- Puntuación obligatoria de 1 a 5 estrellas
    score SMALLINT NOT NULL,
    
    -- Comentario opcional con longitud máxima controlada
    comment VARCHAR(500) NULL,
    
    -- Auditoría temporal
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Restricción de Integridad Referencial Interna
    CONSTRAINT fk_customer_ratings_customer
        FOREIGN KEY (customer_id) 
        REFERENCES customers(id) 
        ON DELETE RESTRICT,

    -- Restricción de Negocio: Puntuación válida entre 1 y 5 estrellas
    CONSTRAINT chk_customer_ratings_score_range
        CHECK (score >= 1 AND score <= 5),

    -- Restricción de Negocio: Evitar calificaciones duplicadas para un mismo viaje
    CONSTRAINT uq_customer_trip_rating
        UNIQUE (customer_id, trip_id)
);

-- ------------------------------------------------------------------------------
-- 3. Índices para Optimización de Consultas en M2
-- ------------------------------------------------------------------------------

-- Optimiza la consulta del historial de calificaciones emitidas por un cliente
CREATE INDEX IF NOT EXISTS idx_customer_ratings_customer_id 
    ON customer_ratings(customer_id);

-- Optimiza la búsqueda de calificaciones por conductor (si el dominio M2 provee consultas de soporte)
CREATE INDEX IF NOT EXISTS idx_customer_ratings_driver_id 
    ON customer_ratings(driver_id);

-- Optimiza la verificación rápida de existencia por viaje
CREATE INDEX IF NOT EXISTS idx_customer_ratings_trip_id 
    ON customer_ratings(trip_id);

-- ------------------------------------------------------------------------------
-- 4. Trigger para actualización automática de `updated_at`
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_ratings_updated_at ON customer_ratings;
CREATE TRIGGER trg_customer_ratings_updated_at
    BEFORE UPDATE ON customer_ratings
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

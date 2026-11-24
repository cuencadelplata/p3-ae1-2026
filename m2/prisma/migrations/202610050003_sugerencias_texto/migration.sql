ALTER TABLE "Direccion" ALTER COLUMN "latitud" DROP NOT NULL;
ALTER TABLE "Direccion" ALTER COLUMN "longitud" DROP NOT NULL;
ALTER TABLE "Direccion" ADD CONSTRAINT "Direccion_coordenadas_par_check"
CHECK (("latitud" IS NULL AND "longitud" IS NULL) OR ("latitud" IS NOT NULL AND "longitud" IS NOT NULL));
CREATE TABLE "ViajeReciente" (
  "viajeId" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "origen" JSONB NOT NULL,
  "destino" JSONB NOT NULL,
  "fechaViaje" TIMESTAMP(3) NOT NULL,
  "fechaReferencia" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ViajeReciente_pkey" PRIMARY KEY ("viajeId")
);
CREATE INDEX "ViajeReciente_clienteId_fechaViaje_idx" ON "ViajeReciente"("clienteId", "fechaViaje");

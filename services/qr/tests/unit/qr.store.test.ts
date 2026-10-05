/*
 * RF-8.2 — Pruebas unitarias del almacenamiento temporal QR en memoria.
 * Ejecutan el contrato común de QrStore contra la implementación en memoria.
 */
import { createInMemoryQrStore } from "../../src/qr.store";
import { describeQrStoreContract } from "../contracts/qr-store.contract";

describeQrStoreContract("createInMemoryQrStore", createInMemoryQrStore);

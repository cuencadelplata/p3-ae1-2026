import { ticketRepositoryContract } from '../../tests/shared/ticket-repository.contract.js';
import { InMemoryTicketRepository } from '../models/ticket.model.js';

// El repositorio en memoria debe cumplir el mismo contrato que el de
// PostgreSQL (tests/integration/postgres-ticket.repository.integration.test.ts).
ticketRepositoryContract('InMemoryTicketRepository', () => new InMemoryTicketRepository());

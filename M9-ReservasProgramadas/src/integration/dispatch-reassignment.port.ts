export interface DispatchReassignmentInput {
  reservaId: string;
  requestId: string;
}

// BLOCKED_CONTRACT_M5: M5 no documenta reapertura, liberación ni reasignación confirmada.
export interface DispatchReassignmentPort {
  requestReassignment(input: DispatchReassignmentInput): Promise<void>;
}

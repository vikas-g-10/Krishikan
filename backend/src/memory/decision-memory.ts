import type { DecisionRecord } from "../types/contracts.ts";

export interface DecisionMemory { save(record: DecisionRecord): Promise<void>; list(): Promise<DecisionRecord[]>; }

export class InMemoryDecisionMemory implements DecisionMemory {
  private readonly records: DecisionRecord[] = [];
  async save(record: DecisionRecord): Promise<void> { this.records.push(record); }
  async list(): Promise<DecisionRecord[]> { return [...this.records]; }
}

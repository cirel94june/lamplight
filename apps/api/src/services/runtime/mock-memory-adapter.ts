import type { MemoryAdapter, MemoryRecallRequest, PersonContextView } from "@lamplight/contracts";

export class MockMemoryAdapter implements MemoryAdapter {
  async recall(_request: MemoryRecallRequest): Promise<PersonContextView> {
    return { memories: [], private_notes: [] };
  }
}

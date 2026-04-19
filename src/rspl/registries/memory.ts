// Memory registry (M1 stub — substring lookup). M3 will add embedding-based
// semantic retrieval. Memory resources are written by the `write_memory` tool.

import { ContextManager } from "../contextManager";
import type { RegistrationRecord } from "../record";

export interface MemoryImpl {
  content: string;
  tags: string[];
}

class MemoryRegistryClass extends ContextManager {
  constructor() {
    super("memory");
  }

  listMemories(agentId: string): RegistrationRecord<MemoryImpl>[] {
    return this.list(agentId) as RegistrationRecord<MemoryImpl>[];
  }
}

export const MemoryRegistry = new MemoryRegistryClass();

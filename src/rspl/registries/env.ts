// Environment registry. Models the chat session as an observed, non-evolvable
// resource. Paper §3.1: env resources are observed, not mutated by SEPL.

import { ContextManager } from "../contextManager";
import type { RegistrationRecord } from "../record";

export interface EnvImpl {
  kind: "chat_session";
  sessionId: string;
  userId: string | null;
}

class EnvRegistryClass extends ContextManager {
  constructor() {
    super("env");
  }

  trackSession(agentId: string, sessionId: string): RegistrationRecord<EnvImpl> {
    return this.register({
      agentId,
      name: `session:${sessionId}`,
      description: `Chat session ${sessionId}`,
      learnable: false,
      impl: { kind: "chat_session", sessionId, userId: null } satisfies EnvImpl,
      contract: { kind: "text", text: "Chat environment (observed, non-evolvable)." },
    }) as RegistrationRecord<EnvImpl>;
  }
}

export const EnvRegistry = new EnvRegistryClass();

// Prompt registry. Holds the system prompt(s) used by the agent policy.
// The primary prompt is named "system" by convention.

import { ContextManager } from "../contextManager";
import type { RegistrationRecord } from "../record";

export interface PromptImpl {
  text: string;
}

class PromptRegistryClass extends ContextManager {
  constructor() {
    super("prompt");
  }

  createSystemPrompt(agentId: string, text: string): RegistrationRecord<PromptImpl> {
    return this.register({
      agentId,
      name: "system",
      description: "Primary system prompt",
      learnable: true,
      impl: { text } satisfies PromptImpl,
      contract: { kind: "text", text },
    }) as RegistrationRecord<PromptImpl>;
  }

  getSystemPrompt(agentId: string): string {
    const rec = this.get(agentId, "system");
    if (!rec) throw new Error(`no system prompt for agent ${agentId}`);
    return (rec.impl as PromptImpl).text;
  }

  updateText(agentId: string, text: string, createdBy = "system"): RegistrationRecord<PromptImpl> {
    const rec = this.get(agentId, "system");
    if (!rec) throw new Error(`no system prompt for agent ${agentId}`);
    return this.update(
      rec.id,
      { impl: { text }, contract: { kind: "text", text } },
      createdBy,
    ) as RegistrationRecord<PromptImpl>;
  }
}

export const PromptRegistry = new PromptRegistryClass();

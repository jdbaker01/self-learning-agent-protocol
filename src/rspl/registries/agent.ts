// Agent-policy registry. Holds the decision policy — model choice, tool-use
// posture, reply style rubric. Per agent we keep a single "policy" resource.

import { ContextManager } from "../contextManager";
import type { RegistrationRecord } from "../record";

export interface AgentPolicyImpl {
  modelTier: "chat" | "reflect";   // which model tier the chat runtime uses
  maxSteps: number;                 // max tool-use steps per turn
  toolChoice: "auto" | "required" | "none";
  replyStyle: string;               // short natural-language rubric the prompt composer will append
}

export const DEFAULT_POLICY: AgentPolicyImpl = {
  modelTier: "chat",
  maxSteps: 5,
  toolChoice: "auto",
  replyStyle: "Be concise and direct. Prefer bullet points for multi-part answers.",
};

class AgentPolicyRegistryClass extends ContextManager {
  constructor() {
    super("agent_policy");
  }

  createPolicy(
    agentId: string,
    impl: AgentPolicyImpl = DEFAULT_POLICY,
  ): RegistrationRecord<AgentPolicyImpl> {
    return this.register({
      agentId,
      name: "policy",
      description: "Agent decision policy",
      learnable: true,
      impl,
      contract: { kind: "policy", usage: "Agent decision policy" },
    }) as RegistrationRecord<AgentPolicyImpl>;
  }

  getPolicy(agentId: string): AgentPolicyImpl {
    const rec = this.get(agentId, "policy");
    if (!rec) throw new Error(`no policy for agent ${agentId}`);
    return rec.impl as AgentPolicyImpl;
  }
}

export const AgentPolicyRegistry = new AgentPolicyRegistryClass();

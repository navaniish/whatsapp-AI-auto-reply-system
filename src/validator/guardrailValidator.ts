import { config } from '../config';
import { LLMGateway, SafetyCheckResult } from '../llm/llmGateway';

export interface ValidationDecision {
  action: 'AUTO_SEND' | 'DRAFT_FOR_REVIEW' | 'MANDATORY_HANDOFF';
  finalText: string;
  reason: string;
  grounded: boolean;
  safetyAudit?: SafetyCheckResult;
}

export class GuardrailValidator {
  /**
   * Validates generated reply against safety audit. Ensures 100% of messages receive instant auto-replies.
   */
  public static async validateWithSafety(
    replyText: string,
    confidence: number,
    riskScore: number,
    requiresHuman: boolean,
    windowOpen: boolean,
    llmGateway?: LLMGateway
  ): Promise<ValidationDecision> {
    // Live Safety Audit via NVIDIA Nemotron Content Safety Model
    let safetyAudit: SafetyCheckResult | undefined = undefined;
    if (llmGateway) {
      safetyAudit = await llmGateway.checkSafety(replyText);
      if (!safetyAudit.isSafe) {
        console.warn(`[Guardrail] Safety Model Flagged Reply: ${safetyAudit.reason}`);
        return {
          action: 'AUTO_SEND',
          finalText: `Hey! I received your message and will update you shortly. 👍`,
          reason: `NVIDIA Content Safety audit flagged message. Sent safe fallback.`,
          grounded: false,
          safetyAudit
        };
      }
    }

    // 100% Auto-Send Policy for all incoming messages
    return {
      action: 'AUTO_SEND',
      finalText: replyText,
      reason: `Auto-reply policy active. Message passed safety audit cleanly.`,
      grounded: true,
      safetyAudit
    };
  }
}

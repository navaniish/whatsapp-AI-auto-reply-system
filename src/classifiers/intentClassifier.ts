import { LLMGateway } from '../llm/llmGateway';

export interface ClassificationResult {
  intent: string;
  urgency: 'low' | 'medium' | 'high';
  sentiment: 'positive' | 'neutral' | 'negative';
  riskScore: number; // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0
  requiresHuman: boolean;
  handoffReason?: string;
  ruleOverride: boolean;
}

export class IntentClassifier {
  private llmGateway: LLMGateway;

  constructor(llmGateway: LLMGateway) {
    this.llmGateway = llmGateway;
  }

  /**
   * Classifies an incoming WhatsApp message.
   * Performs fast-path deterministic rule checks first, then falls back to LLM classification.
   */
  public async classify(messageText: string, windowOpen: boolean): Promise<ClassificationResult> {
    const lowerText = messageText.trim().toLowerCase();

    // 1. Fast-Path Deterministic Override Rules
    if (/\b(human|agent|person|representative|call me|support team|operator)\b/i.test(lowerText)) {
      return {
        intent: 'HUMAN_REQUEST',
        urgency: 'high',
        sentiment: 'neutral',
        riskScore: 1.0,
        confidence: 1.0,
        requiresHuman: true,
        handoffReason: 'User explicitly requested a human agent.',
        ruleOverride: true
      };
    }

    if (/\b(stop|unsubscribe|cancel|optout|opt out|don't text|delete my data|forget me)\b/i.test(lowerText)) {
      return {
        intent: 'DATA_RIGHTS_OR_OPTOUT',
        urgency: 'high',
        sentiment: 'neutral',
        riskScore: 1.0,
        confidence: 1.0,
        requiresHuman: true,
        handoffReason: 'User triggered explicit opt-out or data deletion request.',
        ruleOverride: true
      };
    }

    if (/\b(refund|dispute|scam|fraud|police|lawyer|legal|sue|suicide|emergency)\b/i.test(lowerText)) {
      return {
        intent: 'HIGH_RISK_EXCEPTION',
        urgency: 'high',
        sentiment: 'negative',
        riskScore: 1.0,
        confidence: 1.0,
        requiresHuman: true,
        handoffReason: 'Sensitive high-risk/legal/safety keyphrase detected.',
        ruleOverride: true
      };
    }

    if (!windowOpen) {
      return {
        intent: 'OUTSIDE_24H_WINDOW',
        urgency: 'medium',
        sentiment: 'neutral',
        riskScore: 0.8,
        confidence: 1.0,
        requiresHuman: true,
        handoffReason: 'WhatsApp 24-hour service window expired.',
        ruleOverride: true
      };
    }

    // 2. Multi-label LLM Classification
    const systemPrompt = `You are a strict security and intent classifier for WhatsApp business & personal conversations.
Classify the user's message into valid JSON format ONLY (no preamble, no markdown formatting).
JSON Schema:
{
  "intent": "FAQ" | "ORDER_STATUS" | "APPOINTMENT" | "COMPLAINT" | "SALES_LEAD" | "TECHNICAL_SUPPORT" | "UNKNOWN",
  "urgency": "low" | "medium" | "high",
  "sentiment": "positive" | "neutral" | "negative",
  "risk_score": 0.0 to 1.0,
  "confidence": 0.0 to 1.0,
  "requires_human": boolean
}`;

    const response = await this.llmGateway.classifyText(systemPrompt, messageText);

    if (response.jsonOutput) {
      const data = response.jsonOutput;
      return {
        intent: data.intent || 'UNKNOWN',
        urgency: data.urgency || 'medium',
        sentiment: data.sentiment || 'neutral',
        riskScore: typeof data.risk_score === 'number' ? data.risk_score : 0.5,
        confidence: typeof data.confidence === 'number' ? data.confidence : 0.8,
        requiresHuman: Boolean(data.requires_human) || (data.risk_score > 0.5),
        handoffReason: data.requires_human ? 'Classifier marked message as requiring human review.' : undefined,
        ruleOverride: false
      };
    }

    // Fallback default if classification parse fails
    return {
      intent: 'UNKNOWN',
      urgency: 'medium',
      sentiment: 'neutral',
      riskScore: 0.5,
      confidence: 0.5,
      requiresHuman: true,
      handoffReason: 'Classifier fallback: uncertain intent.',
      ruleOverride: false
    };
  }
}

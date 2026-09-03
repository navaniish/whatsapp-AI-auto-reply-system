export interface RedactionResult {
  redactedText: string;
  detectedTypes: string[];
  mapping: Record<string, string>;
}

export class PiiRedactor {
  private static readonly PATTERNS = {
    CREDIT_CARD: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    PHONE_INT: /\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
    SECRET_KEY: /(?:api[_-]?key|secret|password|bearer|auth|token)\s*[:=]\s*['"]?([a-zA-Z0-9_\-\.]{16,})['"]?/gi,
  };

  /**
   * Redacts sensitive data from message text before sending to LLM or Vector Embeddings.
   */
  public static redact(text: string): RedactionResult {
    let redactedText = text;
    const detectedTypes: string[] = [];
    const mapping: Record<string, string> = {};

    // 1. Redact Secrets & Credentials
    let secretCounter = 1;
    redactedText = redactedText.replace(this.PATTERNS.SECRET_KEY, (match, secretVal) => {
      detectedTypes.push('SECRET_KEY');
      const placeholder = `[REDACTED_SECRET_${secretCounter++}]`;
      mapping[placeholder] = match;
      return placeholder;
    });

    // 2. Redact Credit Card Numbers
    let cardCounter = 1;
    redactedText = redactedText.replace(this.PATTERNS.CREDIT_CARD, (match) => {
      detectedTypes.push('CREDIT_CARD');
      const placeholder = `[REDACTED_CARD_${cardCounter++}]`;
      mapping[placeholder] = match;
      return placeholder;
    });

    // 3. Redact Emails
    let emailCounter = 1;
    redactedText = redactedText.replace(this.PATTERNS.EMAIL, (match) => {
      detectedTypes.push('EMAIL');
      const placeholder = `[REDACTED_EMAIL_${emailCounter++}]`;
      mapping[placeholder] = match;
      return placeholder;
    });

    return {
      redactedText,
      detectedTypes: Array.from(new Set(detectedTypes)),
      mapping
    };
  }
}

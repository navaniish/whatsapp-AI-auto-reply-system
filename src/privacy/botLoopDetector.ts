export class BotLoopDetector {
  /**
   * Evaluates whether an incoming message is from an automated system bot (e.g. OTPs, marketing bots, system notifications).
   * Real human contacts will NEVER be blocked or locked out.
   */
  public static shouldSuppressForBotLoop(remoteJid: string, messageText: string): { isBotLoop: boolean; reason?: string } {
    const lower = messageText.toLowerCase();

    // Automated System Bot Content Signatures ONLY
    const botSignatures = [
      /\b(this is an automated message|do not reply|automated response)\b/i,
      /\b(reply 1 for|press 1|reply stop|type menu)\b/i,
      /\b(your otp is|verification code|transaction id|order #|shipment update)\b/i,
      /\b(powered by|bot engine|automated notification|noreply)\b/i
    ];

    for (const sig of botSignatures) {
      if (sig.test(lower)) {
        return { isBotLoop: true, reason: `Message matches automated bot signature: ${sig.source}` };
      }
    }

    return { isBotLoop: false };
  }
}

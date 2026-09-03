import { config } from '../config';

export interface DraftQueueItem {
  id: string;
  remoteJid: string;
  customerName: string;
  userMessage: string;
  intent: string;
  confidence: number;
  draftReply: string;
  createdAt: Date;
}

export class WhatsAppReviewQueue {
  private queue: Map<string, DraftQueueItem> = new Map();
  private sendFunction?: (remoteJid: string, text: string) => Promise<boolean>;

  public setSender(fn: (remoteJid: string, text: string) => Promise<boolean>) {
    this.sendFunction = fn;
  }

  /**
   * Pushes a draft reply into the HITL approval queue and sends an alert directly to the Owner's WhatsApp number.
   */
  public async submitDraftForReview(item: DraftQueueItem): Promise<void> {
    this.queue.set(item.id, item);

    console.log(`\n========================================`);
    console.log(`[HITL DRAFT QUEUED FOR WHATSAPP OWNER APPROVAL]`);
    console.log(`Draft ID: ${item.id}`);
    console.log(`Customer: ${item.customerName} (${item.remoteJid})`);
    console.log(`User Said: "${item.userMessage}"`);
    console.log(`Intent: ${item.intent} | Confidence: ${item.confidence}`);
    console.log(`Proposed Draft: "${item.draftReply}"`);
    console.log(`========================================\n`);

    // If Owner WhatsApp number is configured, send WhatsApp alert to Owner
    if (config.OWNER_WHATSAPP_NUMBER && this.sendFunction) {
      const alertMessage =
        `🚨 *AI DRAFT APPROVAL REQUEST*\n` +
        `*ID:* \`${item.id}\`\n` +
        `*From:* ${item.customerName} (${item.remoteJid})\n` +
        `*Customer Said:* "${item.userMessage}"\n` +
        `*Intent:* ${item.intent} (Confidence: ${item.confidence})\n\n` +
        `*Proposed AI Draft Reply:*\n"${item.draftReply}"\n\n` +
        `----------------------------------------\n` +
        `*To respond, reply to this message with:*\n` +
        `• \`approve ${item.id}\` (Send as is)\n` +
        `• \`edit ${item.id} Your custom reply here\`\n` +
        `• \`reject ${item.id}\``;

      await this.sendFunction(config.OWNER_WHATSAPP_NUMBER, alertMessage);
    }
  }

  public getDraft(id: string): DraftQueueItem | undefined {
    return this.queue.get(id);
  }

  public removeDraft(id: string): void {
    this.queue.delete(id);
  }
}

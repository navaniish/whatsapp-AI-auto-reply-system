import axios from 'axios';
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

export class TelegramReviewQueue {
  private queue: Map<string, DraftQueueItem> = new Map();

  /**
   * Pushes a draft reply into the HITL approval queue and alerts the owner via Telegram.
   */
  public async submitDraftForReview(item: DraftQueueItem): Promise<void> {
    this.queue.set(item.id, item);
    console.log(`\n========================================`);
    console.log(`[HITL DRAFT QUEUED FOR HUMAN REVIEW]`);
    console.log(`ID: ${item.id}`);
    console.log(`To: ${item.customerName} (${item.remoteJid})`);
    console.log(`User Said: "${item.userMessage}"`);
    console.log(`Intent: ${item.intent} | Confidence: ${item.confidence}`);
    console.log(`Proposed Draft: "${item.draftReply}"`);
    console.log(`========================================\n`);

    // If Telegram Bot token is configured, send Telegram alert
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_ADMIN_CHAT_ID) {
      try {
        const text = `🚨 *WhatsApp AI Draft Needs Review*\n\n` +
          `*From:* ${item.customerName} (\`${item.remoteJid}\`)\n` +
          `*User Message:* "${item.userMessage}"\n` +
          `*Intent:* ${item.intent} (Confidence: ${item.confidence})\n\n` +
          `*Draft Reply:* \n"${item.draftReply}"`;

        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: config.TELEGRAM_ADMIN_CHAT_ID,
          text,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve & Send', callback_data: `approve_${item.id}` },
                { text: '❌ Reject', callback_data: `reject_${item.id}` }
              ]
            ]
          }
        });
      } catch (err) {
        console.warn('Failed to send Telegram alert:', (err as Error).message);
      }
    }
  }

  public getDraft(id: string): DraftQueueItem | undefined {
    return this.queue.get(id);
  }

  public removeDraft(id: string): void {
    this.queue.delete(id);
  }
}

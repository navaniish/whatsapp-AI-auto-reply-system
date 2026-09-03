import { Message } from 'whatsapp-web.js';

export class ContactQueueManager {
  private static processingJids: Set<string> = new Set();
  private static queues: Map<string, Array<{ msg: Message; resolve: () => void }>> = new Map();

  /**
   * Enqueues an incoming message task per contact JID to guarantee sequential processing.
   */
  public static async enqueue(remoteJid: string, msg: Message, processor: (msg: Message) => Promise<void>): Promise<void> {
    const cleanJid = remoteJid.toLowerCase();

    if (this.processingJids.has(cleanJid)) {
      console.log(`⏳ [QUEUE] Contact ${cleanJid} is currently processing another message. Queuing next message...`);
      return new Promise<void>((resolve) => {
        const list = this.queues.get(cleanJid) || [];
        list.push({
          msg,
          resolve: async () => {
            try {
              await processor(msg);
            } finally {
              resolve();
            }
          }
        });
        this.queues.set(cleanJid, list);
      });
    }

    this.processingJids.add(cleanJid);
    try {
      await processor(msg);
    } finally {
      this.processNext(cleanJid);
    }
  }

  private static processNext(cleanJid: string): void {
    const list = this.queues.get(cleanJid) || [];
    if (list.length > 0) {
      const next = list.shift()!;
      if (list.length === 0) {
        this.queues.delete(cleanJid);
      } else {
        this.queues.set(cleanJid, list);
      }
      // Run next message task in queue
      next.resolve();
    } else {
      this.processingJids.delete(cleanJid);
    }
  }
}

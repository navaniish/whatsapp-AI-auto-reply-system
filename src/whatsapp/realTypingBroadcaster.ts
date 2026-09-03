import { Chat } from 'whatsapp-web.js';

export class RealTypingBroadcaster {
  /**
   * Broadcasts WhatsApp's native 'composing...' (typing) indicator directly over WebSocket.
   */
  public static async startTyping(chat: Chat | undefined, pupPage: any, remoteJid: string): Promise<void> {
    try {
      if (chat && typeof chat.sendStateTyping === 'function') {
        await chat.sendStateTyping();
      }
    } catch { /* fallback to pupPage */ }

    if (pupPage) {
      try {
        await pupPage.evaluate((jid: string) => {
          try {
            const Store = (window as any).Store;
            if (Store && Store.SendChatState && Store.SendChatState.sendChatStateComposing) {
              Store.SendChatState.sendChatStateComposing(jid);
            } else if ((window as any).WWebJS && (window as any).WWebJS.sendChatstate) {
              (window as any).WWebJS.sendChatstate('typing', jid);
            }
          } catch { /* ignore */ }
        }, remoteJid);
      } catch { /* ignore */ }
    }
  }

  /**
   * Clears typing status indicator.
   */
  public static async stopTyping(chat: Chat | undefined, pupPage: any, remoteJid: string): Promise<void> {
    try {
      if (chat && typeof chat.clearState === 'function') {
        await chat.clearState();
      }
    } catch { /* fallback to pupPage */ }

    if (pupPage) {
      try {
        await pupPage.evaluate((jid: string) => {
          try {
            const Store = (window as any).Store;
            if (Store && Store.SendChatState && Store.SendChatState.sendChatStatePaused) {
              Store.SendChatState.sendChatStatePaused(jid);
            } else if ((window as any).WWebJS && (window as any).WWebJS.sendChatstate) {
              (window as any).WWebJS.sendChatstate('clear', jid);
            }
          } catch { /* ignore */ }
        }, remoteJid);
      } catch { /* ignore */ }
    }
  }

  /**
   * Holds the real typing indicator active while calculating human typing speed.
   */
  public static async broadcastTypingStatus(replyText: string): Promise<void> {
    const charCount = replyText.length;
    const baseDelayMs = 1200; // Natural reaction time
    const typingTimeMs = Math.min(Math.max(charCount * 35 + baseDelayMs, 1500), 4500);

    console.log(`⏳ [REAL TYPING INDICATOR] Typing broadcast active for ${typingTimeMs}ms (${charCount} chars)...`);
    await new Promise(resolve => setTimeout(resolve, typingTimeMs));
  }
}

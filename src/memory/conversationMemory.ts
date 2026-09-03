export interface ChatTurn {
  sender: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

export class ConversationMemoryEngine {
  private static history: Map<string, ChatTurn[]> = new Map();
  private static readonly MAX_TURNS = 15;

  private static clean(jid: string): string {
    return jid.toLowerCase().replace(/@(c\.us|s\.whatsapp\.net|g\.us|lid)$/i, '');
  }

  /**
   * Adds a message turn to the contact's conversation history.
   */
  public static addTurn(remoteJid: string, role: 'user' | 'assistant', text: string, senderName?: string): void {
    const cleanJid = this.clean(remoteJid);
    const turns = this.history.get(cleanJid) || [];
    turns.push({
      sender: senderName || (role === 'user' ? 'Contact' : 'Me (AI)'),
      role,
      text,
      timestamp: new Date()
    });

    // Maintain sliding window
    if (turns.length > this.MAX_TURNS) {
      turns.shift();
    }
    this.history.set(cleanJid, turns);
  }

  /**
   * Gets conversation history formatted for LLM system prompt.
   */
  public static getFormattedHistory(remoteJid: string): string {
    const cleanJid = this.clean(remoteJid);
    const turns = this.history.get(cleanJid) || [];
    if (turns.length === 0) return 'No previous conversation history.';

    return turns
      .map(t => `[${t.timestamp.toLocaleTimeString()}] ${t.sender}: "${t.text}"`)
      .join('\n');
  }

  /**
   * Clears history for a specific JID.
   */
  public static clearHistory(remoteJid: string): void {
    this.history.delete(this.clean(remoteJid));
  }
}

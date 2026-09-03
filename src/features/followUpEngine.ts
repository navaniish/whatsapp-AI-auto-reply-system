import * as fs from 'fs';
import * as path from 'path';

// ── Follow-Up Engine ─────────────────────────────────────────────────────────

export interface FollowUpConfig {
  enabled: boolean;
  defaultDelayHours: number;
  perContactDelay: Record<string, number>; // jid → hours
}

interface PendingFollowUp {
  jid: string;
  contactName: string;
  lastRepliedAt: number; // Date.now()
  followUpSent: boolean;
}

const CONFIG_FILE = path.join(process.cwd(), 'followup_config.json');

function loadConfig(): FollowUpConfig {
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* ignore */ }
  }
  return { enabled: false, defaultDelayHours: 4, perContactDelay: {} };
}

function saveConfig(cfg: FollowUpConfig): void {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch { /* ignore */ }
}

// Sender function injected from whatsappClient so FollowUpEngine can send messages
let _sender: ((jid: string, text: string) => Promise<void>) | null = null;
// LLM function to generate contextual follow-ups
let _llmGenerate: ((context: string) => Promise<string>) | null = null;

export class FollowUpEngine {
  private static config: FollowUpConfig = loadConfig();
  private static pending: Map<string, PendingFollowUp> = new Map();
  private static timerHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Inject sender and LLM generator dependencies.
   * Must be called after initialization.
   */
  static initialize(
    sender: (jid: string, text: string) => Promise<void>,
    llmGenerate: (context: string) => Promise<string>
  ): void {
    _sender = sender;
    _llmGenerate = llmGenerate;

    if (this.timerHandle) clearInterval(this.timerHandle);
    // Check every 15 minutes
    this.timerHandle = setInterval(() => this.checkPending(), 15 * 60 * 1000);
    console.log('[Follow-Up Engine] Initialized. Checking every 15 minutes.');
  }

  static getConfig(): FollowUpConfig {
    return { ...this.config, perContactDelay: { ...this.config.perContactDelay } };
  }

  static setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    saveConfig(this.config);
  }

  static setDefaultDelay(hours: number): void {
    this.config.defaultDelayHours = hours;
    saveConfig(this.config);
  }

  static setContactDelay(jid: string, hours: number): void {
    this.config.perContactDelay[jid] = hours;
    saveConfig(this.config);
    console.log(`[Follow-Up] Set ${hours}h delay for ${jid}`);
  }

  /**
   * Called when AI sends a reply to a contact.
   * Starts a follow-up timer for that contact.
   */
  static trackReplySent(jid: string, contactName: string): void {
    if (!this.config.enabled) return;
    this.pending.set(jid, {
      jid,
      contactName,
      lastRepliedAt: Date.now(),
      followUpSent: false,
    });
  }

  /**
   * Called when a contact sends us a message (they replied).
   * Cancels the pending follow-up for that contact.
   */
  static cancelFollowUp(jid: string): void {
    if (this.pending.has(jid)) {
      this.pending.delete(jid);
    }
  }

  /**
   * Background check: if a contact hasn't replied within delay window, send follow-up.
   */
  private static async checkPending(): Promise<void> {
    if (!this.config.enabled || !_sender || !_llmGenerate) return;

    const now = Date.now();
    for (const [jid, entry] of this.pending.entries()) {
      if (entry.followUpSent) continue;

      const delayHours = this.config.perContactDelay[jid] ?? this.config.defaultDelayHours;
      const delayMs = delayHours * 60 * 60 * 1000;
      if (now - entry.lastRepliedAt >= delayMs) {
        console.log(`[Follow-Up] ${entry.contactName} hasn't replied in ${delayHours}h. Sending follow-up...`);
        try {
          const followUpText = await _llmGenerate(
            `Generate a short, friendly, natural follow-up message to ${entry.contactName} who hasn't replied to our last message in ${delayHours} hours. Be casual and non-pushy. Max 1 sentence.`
          );
          await _sender(jid, followUpText);
          entry.followUpSent = true;
          console.log(`[Follow-Up] Sent to ${entry.contactName}: "${followUpText}"`);
        } catch (err) {
          console.error(`[Follow-Up] Failed to send to ${jid}:`, (err as Error).message);
        }
      }
    }
  }
}

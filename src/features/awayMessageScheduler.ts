import * as fs from 'fs';
import * as path from 'path';

// ── Away Message Scheduler ──────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), 'away_config.json');

interface AwayConfig {
  defaultMessage: string;
  customMessages: Record<string, string>; // jid → custom message
}

function loadConfig(): AwayConfig {
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* ignore */ }
  }
  return {
    defaultMessage: "Hey! I'm currently away but will get back to you soon 🙏",
    customMessages: {},
  };
}

function saveConfig(cfg: AwayConfig): void {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch { /* ignore */ }
}

export class AwayMessageScheduler {
  private static config: AwayConfig = loadConfig();

  /**
   * Get the away message for a specific contact.
   * Returns custom message if set, else the default.
   */
  static getAwayMessage(jid?: string): string {
    if (jid && this.config.customMessages[jid]) {
      return this.config.customMessages[jid];
    }
    return this.config.defaultMessage;
  }

  static setDefaultMessage(message: string): void {
    this.config.defaultMessage = message;
    saveConfig(this.config);
    console.log(`[Away Message] Default away message updated.`);
  }

  static setCustomMessage(jid: string, message: string): void {
    this.config.customMessages[jid] = message;
    saveConfig(this.config);
    console.log(`[Away Message] Custom message set for ${jid}`);
  }

  static removeCustomMessage(jid: string): void {
    delete this.config.customMessages[jid];
    saveConfig(this.config);
  }

  static getConfig(): AwayConfig {
    return { ...this.config, customMessages: { ...this.config.customMessages } };
  }
}

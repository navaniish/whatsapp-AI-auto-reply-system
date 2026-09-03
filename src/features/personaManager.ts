import * as fs from 'fs';
import * as path from 'path';

// ── Persona Types ───────────────────────────────────────────────────────────

export type PersonaMode = 'FRIENDLY' | 'PROFESSIONAL' | 'FUNNY';

export interface PersonaDefinition {
  mode: PersonaMode;
  label: string;
  emoji: string;
  systemPrefix: string;
}

export const PERSONAS: Record<PersonaMode, PersonaDefinition> = {
  FRIENDLY: {
    mode: 'FRIENDLY',
    label: 'Friendly',
    emoji: '😊',
    systemPrefix: 'You are warm, casual, and speak like a close friend. Use informal language, match their dialect (Hinglish/Telugu/English), and keep it relaxed.',
  },
  PROFESSIONAL: {
    mode: 'PROFESSIONAL',
    label: 'Professional',
    emoji: '💼',
    systemPrefix: 'You are polished, professional, and concise. Maintain formal English. Be helpful and direct with no slang or emojis.',
  },
  FUNNY: {
    mode: 'FUNNY',
    label: 'Funny',
    emoji: '😄',
    systemPrefix: 'You are witty, humorous, and playful. Use light banter, puns, and jokes where appropriate, while still being helpful. Keep the energy light.',
  },
};

// ── Persona Manager ─────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), 'persona_config.json');

function loadConfig(): Record<string, PersonaMode> {
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* ignore */ }
  }
  return {};
}

function saveConfig(cfg: Record<string, PersonaMode>): void {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch { /* ignore */ }
}

export class PersonaManager {
  private static config: Record<string, PersonaMode> = loadConfig();

  static getPersona(jid: string): PersonaDefinition {
    const mode = this.config[jid] || 'FRIENDLY';
    return PERSONAS[mode];
  }

  static setPersona(jid: string, mode: PersonaMode): void {
    this.config[jid] = mode;
    saveConfig(this.config);
    console.log(`[Persona] Set ${mode} persona for ${jid}`);
  }

  static removePersona(jid: string): void {
    delete this.config[jid];
    saveConfig(this.config);
  }

  static getAllPersonas(): Record<string, PersonaMode> {
    return { ...this.config };
  }

  /**
   * Build a persona-injected system prompt prefix string.
   */
  static buildPersonaPrefix(jid: string): string {
    const persona = this.getPersona(jid);
    return persona.systemPrefix;
  }
}

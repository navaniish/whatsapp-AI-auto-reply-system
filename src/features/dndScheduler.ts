import * as fs from 'fs';
import * as path from 'path';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DndConfig {
  enabled: boolean;
  startHour: number; // 0-23
  startMinute: number; // 0-59
  endHour: number;
  endMinute: number;
}

// ── DND Scheduler ───────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), 'dnd_config.json');

function loadConfig(): DndConfig {
  if (fs.existsSync(CONFIG_FILE)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* ignore */ }
  }
  return { enabled: false, startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 };
}

function saveConfig(cfg: DndConfig): void {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); } catch { /* ignore */ }
}

export class DndScheduler {
  private static config: DndConfig = loadConfig();

  static getConfig(): DndConfig {
    return { ...this.config };
  }

  /**
   * Set DND window. Times in "HH:MM" format (24-hour).
   * Example: setDndWindow("23:00", "07:00", true)
   */
  static setDndWindow(start: string, end: string, enabled: boolean = true): void {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    this.config = { enabled, startHour: sh, startMinute: sm, endHour: eh, endMinute: em };
    saveConfig(this.config);
    console.log(`[DND Scheduler] DND window set: ${start} → ${end} (enabled: ${enabled})`);
  }

  static setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    saveConfig(this.config);
  }

  /**
   * Returns true if the current time is within the DND window.
   */
  static isInDndWindow(): boolean {
    if (!this.config.enabled) return false;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = this.config.startHour * 60 + this.config.startMinute;
    const endMinutes = this.config.endHour * 60 + this.config.endMinute;

    // Handle overnight windows (e.g. 23:00 → 07:00)
    if (startMinutes > endMinutes) {
      return nowMinutes >= startMinutes || nowMinutes < endMinutes;
    }
    // Handle same-day windows (e.g. 09:00 → 17:00)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  static formatWindow(): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(this.config.startHour)}:${pad(this.config.startMinute)} – ${pad(this.config.endHour)}:${pad(this.config.endMinute)}`;
  }
}

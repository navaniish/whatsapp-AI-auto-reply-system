import * as fs from 'fs';
import * as path from 'path';

// ── Contact Blocklist ───────────────────────────────────────────────────────

const BLOCKLIST_FILE = path.join(process.cwd(), 'blocklist.json');

function loadBlocklist(): Set<string> {
  if (fs.existsSync(BLOCKLIST_FILE)) {
    try {
      const arr: string[] = JSON.parse(fs.readFileSync(BLOCKLIST_FILE, 'utf8'));
      return new Set(arr);
    } catch { /* ignore */ }
  }
  return new Set();
}

function saveBlocklist(set: Set<string>): void {
  try {
    fs.writeFileSync(BLOCKLIST_FILE, JSON.stringify([...set], null, 2));
  } catch { /* ignore */ }
}

export class ContactBlocklist {
  private static blocked: Set<string> = loadBlocklist();

  static isBlocked(jid: string): boolean {
    // Normalize: strip @c.us suffix for lookup
    const normalized = jid.replace(/@.+$/, '');
    return this.blocked.has(jid) || this.blocked.has(normalized);
  }

  static add(jid: string): void {
    this.blocked.add(jid);
    saveBlocklist(this.blocked);
    console.log(`[Blocklist] Added: ${jid}`);
  }

  static remove(jid: string): void {
    this.blocked.delete(jid);
    // Also try without suffix
    this.blocked.delete(jid.replace(/@.+$/, ''));
    saveBlocklist(this.blocked);
    console.log(`[Blocklist] Removed: ${jid}`);
  }

  static getAll(): string[] {
    return [...this.blocked];
  }

  static clear(): void {
    this.blocked.clear();
    saveBlocklist(this.blocked);
  }
}

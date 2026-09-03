import * as fs from 'fs';
import * as path from 'path';

// ── Analytics Data Types ────────────────────────────────────────────────────

export interface ContactStat {
  jid: string;
  name: string;
  messagesReceived: number;
  repliesSent: number;
  lastMessageAt: string;
  avgResponseTimeMs: number;
}

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  messagesReceived: number;
  repliesSent: number;
}

export interface AnalyticsData {
  totalMessagesReceived: number;
  totalRepliesSent: number;
  totalResponseTimeMs: number;
  responseCount: number;
  contactStats: Record<string, ContactStat>;
  dailyBuckets: DailyBucket[];
  startedAt: string;
}

// ── Analytics Engine ────────────────────────────────────────────────────────

const DATA_FILE = path.join(process.cwd(), 'analytics_data.json');

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadData(): AnalyticsData {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* ignore */ }
  }
  return {
    totalMessagesReceived: 0,
    totalRepliesSent: 0,
    totalResponseTimeMs: 0,
    responseCount: 0,
    contactStats: {},
    dailyBuckets: [],
    startedAt: new Date().toISOString(),
  };
}

function saveData(data: AnalyticsData): void {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch { /* ignore */ }
}

function getDailyBucket(data: AnalyticsData): DailyBucket {
  const today = todayKey();
  let bucket = data.dailyBuckets.find(b => b.date === today);
  if (!bucket) {
    bucket = { date: today, messagesReceived: 0, repliesSent: 0 };
    data.dailyBuckets.push(bucket);
    // Keep only last 30 days
    if (data.dailyBuckets.length > 30) data.dailyBuckets.shift();
  }
  return bucket;
}

export class AnalyticsEngine {
  private static data: AnalyticsData = loadData();
  private static pendingIncoming: Map<string, number> = new Map(); // jid -> timestamp when message arrived

  static recordIncoming(jid: string, contactName: string): void {
    const d = this.data;
    d.totalMessagesReceived++;
    getDailyBucket(d).messagesReceived++;

    if (!d.contactStats[jid]) {
      d.contactStats[jid] = {
        jid,
        name: contactName,
        messagesReceived: 0,
        repliesSent: 0,
        lastMessageAt: new Date().toISOString(),
        avgResponseTimeMs: 0,
      };
    }
    const cs = d.contactStats[jid];
    cs.messagesReceived++;
    cs.lastMessageAt = new Date().toISOString();
    cs.name = contactName || cs.name;

    this.pendingIncoming.set(jid, Date.now());
    saveData(d);
  }

  static recordReply(jid: string): void {
    const d = this.data;
    d.totalRepliesSent++;
    getDailyBucket(d).repliesSent++;

    if (d.contactStats[jid]) {
      d.contactStats[jid].repliesSent++;
    }

    // Record response time
    const incomingTs = this.pendingIncoming.get(jid);
    if (incomingTs) {
      const elapsed = Date.now() - incomingTs;
      d.totalResponseTimeMs += elapsed;
      d.responseCount++;
      if (d.contactStats[jid]) {
        const cs = d.contactStats[jid];
        cs.avgResponseTimeMs = Math.round((cs.avgResponseTimeMs * (cs.repliesSent - 1) + elapsed) / cs.repliesSent);
      }
      this.pendingIncoming.delete(jid);
    }
    saveData(d);
  }

  static getStats(): AnalyticsData {
    return this.data;
  }

  static getAvgResponseTimeMs(): number {
    const d = this.data;
    if (d.responseCount === 0) return 0;
    return Math.round(d.totalResponseTimeMs / d.responseCount);
  }

  static getTopContacts(limit = 10): ContactStat[] {
    return Object.values(this.data.contactStats)
      .sort((a, b) => b.messagesReceived - a.messagesReceived)
      .slice(0, limit);
  }

  static getLast7DaysBuckets(): DailyBucket[] {
    const d = this.data;
    const today = todayKey();
    const result: DailyBucket[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const bucket = d.dailyBuckets.find(b => b.date === date) || { date, messagesReceived: 0, repliesSent: 0 };
      result.push(bucket);
    }
    return result;
  }

  static reset(): void {
    this.data = {
      totalMessagesReceived: 0,
      totalRepliesSent: 0,
      totalResponseTimeMs: 0,
      responseCount: 0,
      contactStats: {},
      dailyBuckets: [],
      startedAt: new Date().toISOString(),
    };
    saveData(this.data);
  }
}

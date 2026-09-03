import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { state } from './state';
import { config } from './config';
import { LLMGateway } from './llm/llmGateway';
import { IntentClassifier } from './classifiers/intentClassifier';
import { ContextAssembler } from './memory/contextAssembler';
import { ConversationMemoryEngine } from './memory/conversationMemory';
import { WhatsAppReviewQueue } from './hitl/whatsappReview';
import { WhatsAppNativeClient } from './whatsapp/whatsappClient';
// ── Advanced Feature Imports ────────────────────────────────────────────────
import { AnalyticsEngine } from './analytics/analyticsEngine';
import { DndScheduler } from './features/dndScheduler';
import { ContactBlocklist } from './features/contactBlocklist';
import { PersonaManager, PersonaMode } from './features/personaManager';
import { AwayMessageScheduler } from './features/awayMessageScheduler';
import { FollowUpEngine } from './features/followUpEngine';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────


// Permissive CORS for local development
app.use(cors({ origin: '*' }));
app.use(express.json());

// Strip any CSP headers so Chrome DevTools can connect without warnings
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Content-Security-Policy');
  res.removeHeader('X-WebKit-CSP');
  next();
});

// ── Services ──────────────────────────────────────────────────────────────────

const llmGateway      = new LLMGateway();
const classifier      = new IntentClassifier(llmGateway);
const contextAssembler = new ContextAssembler();
const hitlQueue       = new WhatsAppReviewQueue();

const whatsappClient = new WhatsAppNativeClient(
  classifier,
  contextAssembler,
  llmGateway,
  hitlQueue
);

hitlQueue.setSender((remoteJid, text) => whatsappClient.sendTextMessage(remoteJid, text));

// ── Routes ────────────────────────────────────────────────────────────────────


// Chrome DevTools well-known endpoint — silences the browser console 404
app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req: Request, res: Response) => {
  res.json({ version: '1.0', workspace: { root: process.cwd(), uuid: 'whatsapp-ai-agent' } });
});

// /qr — Live scannable QR code page
app.get('/qr', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (state.status === 'connected') {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WhatsApp Connected</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px;text-align:center}
h1{font-size:28px}p{color:#8b949e}</style></head>
<body><h1>✅ WhatsApp Connected!</h1><p>Your AI Agent is live and replying to messages.</p></body></html>`);
    return;
  }

  if (!state.qrString) {
    res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"><title>QR Loading...</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px}
.spin{width:44px;height:44px;border:4px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
p{color:#8b949e}</style></head>
<body><div class="spin"></div><p>Starting WhatsApp engine… auto-refreshes in 3s</p></body></html>`);
    return;
  }

  const qrDataUrl = await QRCode.toDataURL(state.qrString, { width: 340, margin: 2 });
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="refresh" content="20">
<title>Scan WhatsApp QR</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#161b22;border:1px solid #30363d;border-radius:20px;padding:40px;text-align:center;max-width:440px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.badge{display:inline-flex;align-items:center;gap:8px;padding:5px 16px;border-radius:20px;font-size:12px;font-weight:700;background:#f0883e22;border:1px solid #f0883e55;color:#f0883e;margin-bottom:24px}
.dot{width:8px;height:8px;border-radius:50%;background:#f0883e;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
h1{font-size:24px;font-weight:700;margin-bottom:8px}
p.sub{color:#8b949e;font-size:13px;margin-bottom:28px}
.qr-wrap{background:#fff;border-radius:16px;padding:12px;display:inline-block}
.hint{margin-top:24px;font-size:13px;color:#8b949e;line-height:1.8}
.hint b{color:#e6edf3}
.refresh{margin-top:16px;font-size:11px;color:#484f58}
</style></head>
<body><div class="card">
  <div class="badge"><span class="dot"></span>Waiting for scan</div>
  <h1>📱 Scan with WhatsApp</h1>
  <p class="sub">Point your phone camera at the QR code below</p>
  <div class="qr-wrap"><img src="${qrDataUrl}" width="320" height="320" alt="WhatsApp QR"/></div>
  <div class="hint">
    Open WhatsApp → <b>Settings</b> → <b>Linked Devices</b><br>→ <b>Link a Device</b> → scan this QR
  </div>
  <p class="refresh">⟳ QR auto-refreshes every 20 seconds</p>
</div></body></html>`);
});


// /scan-unread — Trigger unread message scan on demand
app.get('/scan-unread', async (_req: Request, res: Response) => {
  try {
    const count = await whatsappClient.processUnreadMessages();
    res.json({ success: true, processedUnreadChats: count });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Root dashboard
app.get('/', (_req: Request, res: Response) => {
  const stats = AnalyticsEngine.getStats();
  const topContacts = AnalyticsEngine.getTopContacts(8);
  const dnd = DndScheduler.getConfig();
  const away = AwayMessageScheduler.getConfig();
  const blocklist = ContactBlocklist.getAll();
  const followUp = FollowUpEngine.getConfig();
  const avgMs = AnalyticsEngine.getAvgResponseTimeMs();
  const avgSec = avgMs > 0 ? (avgMs / 1000).toFixed(1) : '—';
  const dailyBuckets = AnalyticsEngine.getLast7DaysBuckets();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>WhatsApp AI Agent — Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{
      --bg:#080b12;--surface:#0e1420;--card:#131926;--border:#1e2535;
      --primary:#6366f1;--primary-light:#818cf8;--green:#22d3a5;--amber:#f59e0b;
      --red:#ef4444;--blue:#38bdf8;--text:#e2e8f0;--muted:#64748b;
    }
    body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
    .header{background:linear-gradient(135deg,#0e1420 0%,#111827 100%);border-bottom:1px solid var(--border);padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
    .logo{display:flex;align-items:center;gap:12px}
    .logo-icon{width:40px;height:40px;background:linear-gradient(135deg,var(--primary),#a855f7);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px}
    .logo-text h1{font-size:18px;font-weight:700;background:linear-gradient(135deg,var(--primary-light),#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .logo-text p{font-size:12px;color:var(--muted);margin-top:1px}
    .status-badge{display:flex;align-items:center;gap:8px;background:#0f2218;border:1px solid #1a4a33;padding:8px 16px;border-radius:100px;font-size:13px;font-weight:500;color:var(--green)}
    .status-dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(34,211,165,0.4)}50%{opacity:.8;box-shadow:0 0 0 6px rgba(34,211,165,0)}}
    .main{padding:28px 32px;max-width:1400px;margin:0 auto}
    .section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:14px}
    /* Metric Cards */
    .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
    .metric-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:22px 24px;position:relative;overflow:hidden;transition:transform .2s,border-color .2s}
    .metric-card:hover{transform:translateY(-2px);border-color:var(--primary)}
    .metric-card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(99,102,241,.06),transparent);pointer-events:none}
    .metric-label{font-size:12px;color:var(--muted);font-weight:500;margin-bottom:10px}
    .metric-value{font-size:36px;font-weight:800;line-height:1;background:linear-gradient(135deg,var(--text),#94a3b8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .metric-value.green{background:linear-gradient(135deg,var(--green),#4ade80);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .metric-value.blue{background:linear-gradient(135deg,var(--blue),#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .metric-value.amber{background:linear-gradient(135deg,var(--amber),#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .metric-icon{position:absolute;right:20px;top:20px;font-size:28px;opacity:.3}
    /* Charts Row */
    .charts-row{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:28px}
    .chart-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:22px 24px}
    .chart-card h3{font-size:14px;font-weight:600;margin-bottom:16px;color:var(--text)}
    /* Features Grid */
    .features-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}
    .feature-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:22px 24px}
    .feature-card h3{font-size:14px;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:8px}
    /* Form elements */
    input,select,textarea{background:#080b12;border:1px solid var(--border);color:var(--text);padding:9px 12px;border-radius:8px;font-size:13px;width:100%;font-family:'Inter',sans-serif;outline:none;transition:border-color .2s}
    input:focus,select:focus,textarea:focus{border-color:var(--primary)}
    textarea{resize:vertical;min-height:60px}
    .row-2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    /* Buttons */
    .btn{padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .2s;font-family:'Inter',sans-serif}
    .btn-primary{background:linear-gradient(135deg,var(--primary),#7c3aed);color:#fff}
    .btn-primary:hover{opacity:.9;transform:translateY(-1px)}
    .btn-green{background:linear-gradient(135deg,var(--green),#059669);color:#fff}
    .btn-green:hover{opacity:.9}
    .btn-red{background:linear-gradient(135deg,var(--red),#dc2626);color:#fff}
    .btn-red:hover{opacity:.9}
    .btn-sm{padding:6px 12px;font-size:12px}
    .btn-block{width:100%;margin-top:10px}
    /* Toggle */
    .toggle-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    .toggle{position:relative;width:44px;height:24px;cursor:pointer}
    .toggle input{opacity:0;width:0;height:0}
    .slider{position:absolute;inset:0;background:#1e2535;border-radius:24px;transition:.3s}
    .slider:before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:#64748b;border-radius:50%;transition:.3s}
    input:checked+.slider{background:var(--primary)}
    input:checked+.slider:before{transform:translateX(20px);background:#fff}
    /* Contact table */
    .contacts-table{width:100%;border-collapse:collapse;font-size:13px}
    .contacts-table th{text-align:left;color:var(--muted);font-weight:500;padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    .contacts-table td{padding:10px 12px;border-bottom:1px solid #0f1620}
    .contacts-table tr:last-child td{border-bottom:none}
    .persona-tag{padding:3px 10px;border-radius:100px;font-size:11px;font-weight:600;background:#1e2535;color:var(--muted)}
    .persona-friendly{background:#0f2218;color:var(--green)}
    .persona-professional{background:#0f1e35;color:var(--blue)}
    .persona-funny{background:#2a1a0f;color:var(--amber)}
    /* Alert */
    .alert{padding:10px 14px;border-radius:8px;font-size:13px;margin-top:10px;display:none}
    .alert.success{background:#0f2218;border:1px solid #1a4a33;color:var(--green)}
    .alert.error{background:#1a0f0f;border:1px solid #4a1a1a;color:var(--red)}
    /* Blocklist chips */
    .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
    .chip{display:flex;align-items:center;gap:6px;background:#1e2535;border-radius:100px;padding:4px 12px;font-size:12px}
    .chip button{background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0;line-height:1}
    @media(max-width:1000px){.metrics{grid-template-columns:repeat(2,1fr)}.charts-row{grid-template-columns:1fr}.features-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:640px){.metrics{grid-template-columns:1fr}.features-grid{grid-template-columns:1fr}.header{flex-direction:column;gap:12px}.main{padding:20px 16px}}
  </style>
</head>
<body>
<header class="header">
  <div class="logo">
    <div class="logo-icon">🤖</div>
    <div class="logo-text">
      <h1>WhatsApp AI Agent</h1>
      <p>Personal contextual reply engine — NVIDIA NIM</p>
    </div>
  </div>
  <div class="status-badge">
    <span class="status-dot"></span>
    <span id="statusText">${state.status === 'connected' ? 'WhatsApp Connected' : 'Connecting...'}</span>
  </div>
</header>

<div class="main">

  <!-- METRICS -->
  <p class="section-title">📊 Live Analytics</p>
  <div class="metrics">
    <div class="metric-card">
      <div class="metric-label">Messages Received</div>
      <div class="metric-value green">${stats.totalMessagesReceived}</div>
      <div class="metric-icon">📨</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Replies Sent</div>
      <div class="metric-value blue">${stats.totalRepliesSent}</div>
      <div class="metric-icon">🚀</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Avg Response Time</div>
      <div class="metric-value amber">${avgSec}s</div>
      <div class="metric-icon">⚡</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Active Contacts</div>
      <div class="metric-value">${Object.keys(stats.contactStats).length}</div>
      <div class="metric-icon">👥</div>
    </div>
  </div>

  <!-- CHARTS ROW -->
  <div class="charts-row">
    <div class="chart-card">
      <h3>📈 Messages & Replies — Last 7 Days</h3>
      <canvas id="activityChart" height="100"></canvas>
    </div>
    <div class="chart-card">
      <h3>👥 Top Active Contacts</h3>
      ${topContacts.length === 0 ? '<p style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0">No contacts yet</p>' : `
      <table class="contacts-table">
        <thead><tr><th>Name</th><th>Msgs</th><th>Replies</th></tr></thead>
        <tbody>${topContacts.map(c => `<tr>
          <td style="font-weight:500">${c.name.slice(0,18)}</td>
          <td style="color:var(--blue)">${c.messagesReceived}</td>
          <td style="color:var(--green)">${c.repliesSent}</td>
        </tr>`).join('')}</tbody>
      </table>`}
    </div>
  </div>

  <!-- FEATURES GRID -->
  <p class="section-title">⚙️ Feature Controls</p>
  <div class="features-grid">

    <!-- DND -->
    <div class="feature-card" id="dnd-card">
      <h3>🌙 Do Not Disturb</h3>
      <div class="toggle-row">
        <span style="font-size:13px;color:var(--muted)">DND Mode</span>
        <label class="toggle">
          <input type="checkbox" id="dndToggle" ${dnd.enabled ? 'checked' : ''} onchange="setDnd()">
          <span class="slider"></span>
        </label>
      </div>
      <div class="row-2" style="margin-bottom:10px">
        <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Start (HH:MM)</label>
          <input type="time" id="dndStart" value="${String(dnd.startHour).padStart(2,'0')}:${String(dnd.startMinute).padStart(2,'0')}"></div>
        <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">End (HH:MM)</label>
          <input type="time" id="dndEnd" value="${String(dnd.endHour).padStart(2,'0')}:${String(dnd.endMinute).padStart(2,'0')}"></div>
      </div>
      <button class="btn btn-primary btn-block" onclick="setDndWindow()">💾 Save DND Window</button>
      <div class="alert" id="dnd-alert"></div>
    </div>

    <!-- Away Message -->
    <div class="feature-card">
      <h3>📅 Away Message</h3>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Message sent during DND</label>
      <textarea id="awayMsg">${away.defaultMessage}</textarea>
      <button class="btn btn-primary btn-block" onclick="saveAwayMsg()">💾 Save Away Message</button>
      <div class="alert" id="away-alert"></div>
    </div>

    <!-- Follow-Up Engine -->
    <div class="feature-card">
      <h3>🔁 Smart Follow-Up</h3>
      <div class="toggle-row">
        <span style="font-size:13px;color:var(--muted)">Auto Follow-Up</span>
        <label class="toggle">
          <input type="checkbox" id="followUpToggle" ${followUp.enabled ? 'checked' : ''} onchange="toggleFollowUp()">
          <span class="slider"></span>
        </label>
      </div>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Default delay (hours)</label>
      <input type="number" id="followUpDelay" value="${followUp.defaultDelayHours}" min="1" max="48" style="margin-bottom:10px">
      <button class="btn btn-primary btn-block" onclick="saveFollowUp()">💾 Save Follow-Up Settings</button>
      <div class="alert" id="followup-alert"></div>
    </div>

    <!-- Blocklist -->
    <div class="feature-card">
      <h3>📋 Contact Blocklist</h3>
      <div class="chips" id="blocklist-chips">
        ${blocklist.map(jid => `<div class="chip"><span>${jid}</span><button onclick="removeBlock('${jid}')">×</button></div>`).join('') || '<span style="font-size:12px;color:var(--muted)">No blocked contacts</span>'}
      </div>
      <input type="text" id="blockJid" placeholder="Phone number (e.g. 919876543210@c.us)" style="margin-bottom:8px">
      <button class="btn btn-red btn-block btn-sm" onclick="addBlock()">🚫 Block Contact</button>
      <div class="alert" id="block-alert"></div>
    </div>

    <!-- Persona Manager -->
    <div class="feature-card">
      <h3>🎭 Persona Profiles</h3>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Contact JID</label>
      <input type="text" id="personaJid" placeholder="919876543210@c.us" style="margin-bottom:8px">
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Persona Mode</label>
      <select id="personaMode" style="margin-bottom:10px">
        <option value="FRIENDLY">😊 Friendly (default)</option>
        <option value="PROFESSIONAL">💼 Professional</option>
        <option value="FUNNY">😄 Funny</option>
      </select>
      <button class="btn btn-primary btn-block" onclick="setPersona()">🎭 Apply Persona</button>
      <div class="alert" id="persona-alert"></div>
    </div>

    <!-- Live Tester -->
    <div class="feature-card">
      <h3>🧪 Live AI Reply Tester</h3>
      <div class="row-2" style="margin-bottom:8px">
        <input type="text" id="testFrom" placeholder="Phone (919876...)" value="919347333478">
        <input type="text" id="testName" placeholder="Name" value="Vishnu">
      </div>
      <input type="text" id="testMsg" placeholder="Type a test message..." value="hello bro em chasthunav" style="margin-bottom:8px">
      <button class="btn btn-green btn-block" onclick="testReply()">🚀 Send Test Message</button>
      <div class="alert" id="test-alert"></div>
    </div>

  </div>

  <!-- Quick Links -->
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <a href="/qr" style="text-decoration:none"><button class="btn btn-primary">📱 QR Code</button></a>
    <a href="/health" style="text-decoration:none"><button class="btn" style="background:#1e2535;color:var(--text)">❤️ Health</button></a>
    <a href="/v1/analytics" style="text-decoration:none"><button class="btn" style="background:#1e2535;color:var(--text)">📊 Analytics JSON</button></a>
    <a href="/v1/debug/chats" style="text-decoration:none"><button class="btn" style="background:#1e2535;color:var(--text)">🐛 Debug Chats</button></a>
    <button class="btn btn-red" onclick="if(confirm('Reset all analytics?'))fetch('/v1/analytics/reset',{method:'POST'}).then(()=>location.reload())">🗑️ Reset Analytics</button>
  </div>

</div>

<script>
// ── Chart ──────────────────────────────────────────────────────────────────
const buckets = ${JSON.stringify(dailyBuckets)};
const ctx = document.getElementById('activityChart').getContext('2d');
new Chart(ctx, {
  type: 'bar',
  data: {
    labels: buckets.map(b => b.date.slice(5)),
    datasets: [
      { label: 'Received', data: buckets.map(b => b.messagesReceived), backgroundColor: 'rgba(99,102,241,.7)', borderRadius: 4 },
      { label: 'Replied', data: buckets.map(b => b.repliesSent), backgroundColor: 'rgba(34,211,165,.7)', borderRadius: 4 }
    ]
  },
  options: {
    responsive: true, plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } } },
    scales: {
      x: { ticks: { color: '#64748b' }, grid: { color: '#1e2535' } },
      y: { ticks: { color: '#64748b' }, grid: { color: '#1e2535' }, beginAtZero: true }
    }
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
function showAlert(id, msg, type='success') {
  const el = document.getElementById(id);
  el.textContent = msg; el.className = 'alert ' + type; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 3500);
}
async function api(url, body, alertId) {
  try {
    const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json();
    if (r.ok) showAlert(alertId, '✅ Saved!');
    else showAlert(alertId, '❌ ' + (d.error || 'Error'), 'error');
  } catch(e) { showAlert(alertId, '❌ ' + e.message, 'error'); }
}

// ── DND ────────────────────────────────────────────────────────────────────
async function setDnd() { await api('/v1/dnd', { enabled: document.getElementById('dndToggle').checked, start: document.getElementById('dndStart').value, end: document.getElementById('dndEnd').value }, 'dnd-alert'); }
async function setDndWindow() { await api('/v1/dnd', { enabled: document.getElementById('dndToggle').checked, start: document.getElementById('dndStart').value, end: document.getElementById('dndEnd').value }, 'dnd-alert'); }

// ── Away Message ───────────────────────────────────────────────────────────
async function saveAwayMsg() { await api('/v1/away-message', { message: document.getElementById('awayMsg').value }, 'away-alert'); }

// ── Follow-Up ──────────────────────────────────────────────────────────────
async function toggleFollowUp() { await api('/v1/followup', { enabled: document.getElementById('followUpToggle').checked, delayHours: Number(document.getElementById('followUpDelay').value) }, 'followup-alert'); }
async function saveFollowUp() { await api('/v1/followup', { enabled: document.getElementById('followUpToggle').checked, delayHours: Number(document.getElementById('followUpDelay').value) }, 'followup-alert'); }

// ── Blocklist ──────────────────────────────────────────────────────────────
async function addBlock() {
  const jid = document.getElementById('blockJid').value.trim();
  if (!jid) return showAlert('block-alert', 'Enter a JID first', 'error');
  await api('/v1/blocklist/add', { jid }, 'block-alert');
  setTimeout(() => location.reload(), 1000);
}
async function removeBlock(jid) {
  await fetch('/v1/blocklist/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({jid}) });
  location.reload();
}

// ── Persona ────────────────────────────────────────────────────────────────
async function setPersona() {
  const jid = document.getElementById('personaJid').value.trim();
  const persona = document.getElementById('personaMode').value;
  if (!jid) return showAlert('persona-alert', 'Enter a contact JID first', 'error');
  await api('/v1/persona', { jid, persona }, 'persona-alert');
}

// ── Test ───────────────────────────────────────────────────────────────────
async function testReply() {
  const from = document.getElementById('testFrom').value;
  const name = document.getElementById('testName').value;
  const body = document.getElementById('testMsg').value;
  const alertEl = document.getElementById('test-alert');
  alertEl.textContent = '⏳ Processing...'; alertEl.className = 'alert success'; alertEl.style.display = 'block';
  try {
    await fetch('/v1/webhooks/whatsapp', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ object:'whatsapp_business_account', entry:[{changes:[{value:{contacts:[{profile:{name}}],messages:[{from,text:{body}}]}}]}] })
    });
    alertEl.textContent = '✅ Sent! Check PM2 logs for the AI reply.';
  } catch(e) { alertEl.textContent = '❌ ' + e.message; alertEl.className = 'alert error'; }
}

// Live clock
setInterval(() => {}, 1000);
</script>
</body>
</html>`);
});

// ── Meta Cloud Webhook Ingress (24/7 Always-On Phone-Independent) ──────────────


// Meta Webhook Verification Endpoint
app.get('/v1/webhooks/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'whatsapp_ai_secure_token';

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('✅ [META CLOUD WEBHOOK] Webhook verification successful!');
      res.status(200).send(challenge);
    } else {
      console.warn('⚠️ [META CLOUD WEBHOOK] Verification token mismatch.');
      res.sendStatus(403);
    }
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Meta WhatsApp Webhook Endpoint</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; line-height: 1.6; }
          .card { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 30px; border: 1px solid #334155; }
          h2 { color: #38bdf8; margin-top: 0; }
          code { background: #0f172a; padding: 4px 8px; border-radius: 4px; color: #a5f3fc; font-family: monospace; }
          .tag { display: inline-block; background: #0284c7; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🌐 Meta WhatsApp Cloud Webhook Active</h2>
          <p><span class="tag">VERIFICATION READY</span></p>
          <p>This URL receives Meta Webhook subscription verification (GET) and live incoming WhatsApp messages (POST).</p>
          <hr style="border-color:#334155; margin: 20px 0;">
          <p><strong>To test Meta Webhook Verification in browser:</strong></p>
          <code>/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=whatsapp_ai_secure_token&hub.challenge=12345</code>
        </div>
      </body>
      </html>
    `);
  }
});

// Meta Webhook Message Receiver
app.post('/v1/webhooks/whatsapp', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.value && change.value.messages) {
            for (const message of change.value.messages) {
              const fromNumber = message.from;
              const text = message.text?.body || '';
              const pushName = change.value.contacts?.[0]?.profile?.name || 'Customer';

              if (text && fromNumber) {
                console.log(`\n☁️ [CLOUD WEBHOOK INGRESS] Received message from ${pushName} (${fromNumber}): "${text}"`);
                // Process via AI pipeline
                await (whatsappClient as any).processIncomingMessage({
                  from: `${fromNumber}@c.us`,
                  body: text,
                  fromMe: false,
                  reply: async (replyText: string) => {
                    console.log(`[Cloud Reply via API] Sending to ${fromNumber}: "${replyText}"`);
                    return true;
                  },
                  _data: { notifyName: pushName }
                });
              }
            }
          }
        }
      }
      res.status(200).send('EVENT_RECEIVED');
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    console.error('❌ [CLOUD WEBHOOK ERROR]', (err as Error).message);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

// Health check JSON endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: config.NODE_ENV,
    ownerWhatsApp: config.OWNER_WHATSAPP_NUMBER || 'Not configured',
    model: 'openai/gpt-oss-20b',
    safetyThresholds: {
      autoSendConfidence: config.AUTO_SEND_CONFIDENCE_THRESHOLD,
    }
  });
});

// On-demand unread message scanner trigger
app.post('/v1/scan-unread', async (_req: Request, res: Response) => {
  try {
    console.log('🔎 [API] Manual unread message scan triggered...');
    const count = await whatsappClient.processUnreadMessages();
    res.status(200).json({ success: true, processedUnreadChats: count });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Multi-turn conversation memory history inspection endpoint
app.get('/v1/memory/:jid', (req: Request, res: Response) => {
  const jid = String(req.params.jid);
  const history = ConversationMemoryEngine.getFormattedHistory(jid);
  res.json({ jid, history });
});

// Debug endpoint to list all WhatsApp Web chats and unread flags
app.get('/v1/debug/chats', async (_req: Request, res: Response) => {
  try {
    const chats = await whatsappClient.getAllChatsDebug();
    res.json({ totalChats: chats.length, chats });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Advanced Feature API Endpoints ────────────────────────────────────────────

// Analytics
app.get('/v1/analytics', (_req: Request, res: Response) => {
  res.json(AnalyticsEngine.getStats());
});
app.post('/v1/analytics/reset', (_req: Request, res: Response) => {
  AnalyticsEngine.reset();
  res.json({ success: true, message: 'Analytics reset.' });
});

// DND Scheduler
app.get('/v1/dnd', (_req: Request, res: Response) => {
  res.json({ ...DndScheduler.getConfig(), currentlyActive: DndScheduler.isInDndWindow() });
});
app.post('/v1/dnd', (req: Request, res: Response) => {
  const { start, end, enabled } = req.body;
  if (!start || !end) return res.status(400).json({ error: 'start and end are required (HH:MM format)' });
  DndScheduler.setDndWindow(start, end, Boolean(enabled));
  res.json({ success: true, config: DndScheduler.getConfig() });
});

// Contact Blocklist
app.get('/v1/blocklist', (_req: Request, res: Response) => {
  res.json({ blocklist: ContactBlocklist.getAll() });
});
app.post('/v1/blocklist/add', (req: Request, res: Response) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).json({ error: 'jid is required' });
  ContactBlocklist.add(jid);
  res.json({ success: true, blocklist: ContactBlocklist.getAll() });
});
app.post('/v1/blocklist/remove', (req: Request, res: Response) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).json({ error: 'jid is required' });
  ContactBlocklist.remove(jid);
  res.json({ success: true, blocklist: ContactBlocklist.getAll() });
});

// Persona Manager
app.get('/v1/persona/:jid', (req: Request, res: Response) => {
  const jid = String(req.params.jid);
  const persona = PersonaManager.getPersona(jid);
  res.json({ jid, ...persona });
});
app.post('/v1/persona', (req: Request, res: Response) => {
  const { jid, persona } = req.body;
  if (!jid || !persona) return res.status(400).json({ error: 'jid and persona are required' });
  const validPersonas: PersonaMode[] = ['FRIENDLY', 'PROFESSIONAL', 'FUNNY'];
  if (!validPersonas.includes(persona)) return res.status(400).json({ error: `persona must be one of: ${validPersonas.join(', ')}` });
  PersonaManager.setPersona(jid, persona as PersonaMode);
  res.json({ success: true, jid, persona });
});
app.get('/v1/personas', (_req: Request, res: Response) => {
  res.json({ personas: PersonaManager.getAllPersonas() });
});

// Away Message
app.get('/v1/away-message', (_req: Request, res: Response) => {
  res.json(AwayMessageScheduler.getConfig());
});
app.post('/v1/away-message', (req: Request, res: Response) => {
  const { message, jid } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (jid) {
    AwayMessageScheduler.setCustomMessage(jid, message);
  } else {
    AwayMessageScheduler.setDefaultMessage(message);
  }
  res.json({ success: true, config: AwayMessageScheduler.getConfig() });
});

// Follow-Up Engine
app.get('/v1/followup', (_req: Request, res: Response) => {
  res.json(FollowUpEngine.getConfig());
});
app.post('/v1/followup', (req: Request, res: Response) => {
  const { enabled, delayHours, jid } = req.body;
  if (typeof enabled === 'boolean') FollowUpEngine.setEnabled(enabled);
  if (typeof delayHours === 'number') {
    if (jid) FollowUpEngine.setContactDelay(jid, delayHours);
    else FollowUpEngine.setDefaultDelay(delayHours);
  }
  res.json({ success: true, config: FollowUpEngine.getConfig() });
});

// ── Start Server ──────────────────────────────────────────────────────────────

const PORT = config.PORT;
app.listen(PORT, async () => {
  console.log(`\n========================================================================`);
  console.log(`🚀 PERSONAL WHATSAPP AI CONTEXTUAL REPLY AGENT ACTIVE`);
  console.log(`📡 Dashboard:  http://localhost:${PORT}`);
  console.log(`❤️  Health:     http://localhost:${PORT}/health`);
  console.log(`========================================================================\n`);

  console.log('Initializing WhatsApp Engine...');
  await whatsappClient.initialize();
});

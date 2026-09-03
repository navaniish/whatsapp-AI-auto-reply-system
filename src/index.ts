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
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WhatsApp AI Agent — Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 16px;
      padding: 40px 48px;
      max-width: 540px;
      width: 100%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #1f6feb22;
      border: 1px solid #1f6feb55;
      color: #58a6ff;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .5px;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 20px;
      text-transform: uppercase;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    h1 { font-size: 26px; font-weight: 700; margin-bottom: 8px; }
    .sub { color: #8b949e; font-size: 14px; margin-bottom: 32px; }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 0;
      border-bottom: 1px solid #21262d;
      font-size: 14px;
    }
    .row:last-child { border-bottom: none; }
    .label { color: #8b949e; }
    .value { font-weight: 600; color: #e6edf3; }
    .green { color: #3fb950; }
    .blue  { color: #58a6ff; }
    .links { margin-top: 28px; display: flex; gap: 12px; }
    a {
      flex: 1;
      text-align: center;
      padding: 10px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: opacity .2s;
    }
    a:hover { opacity: .8; }
    .a-health { background: #238636; color: #fff; }
  </style>
</head>
<body>
<div class="card">
  <div class="badge"><span class="dot"></span> Live</div>
  <h1>📱 WhatsApp AI Agent</h1>
  <p class="sub">Personal contextual reply engine powered by NVIDIA NIM</p>

  <div class="row">
    <span class="label">Status</span>
    <span class="value green">● Running</span>
  </div>
  <div class="row">
    <span class="label">Owner Number</span>
    <span class="value blue">+91 7075708980</span>
  </div>
  <div class="row">
    <span class="label">AI Model</span>
    <span class="value">openai/gpt-oss-20b (NVIDIA NIM)</span>
  </div>
  <div class="row">
    <span class="label">Auto-Send Threshold</span>
    <span class="value">${config.AUTO_SEND_CONFIDENCE_THRESHOLD * 100}% confidence</span>
  </div>
  <div class="row">
    <span class="label">Draft Threshold</span>
    <span class="value">${config.DRAFT_CONFIDENCE_THRESHOLD * 100}% confidence</span>
  </div>
  <div class="row">
    <span class="label">Environment</span>
    <span class="value">${config.NODE_ENV}</span>
  </div>
  <div class="row">
    <span class="label">Server Time</span>
    <span class="value" id="ts"></span>
  </div>

  <div class="links">
    <a class="a-health" href="/health">Health Check ↗</a>
  </div>

  <div style="margin-top: 30px; border-top: 1px solid #21262d; padding-top: 20px;">
    <h3 style="font-size: 16px; margin-bottom: 12px; color: #38bdf8;">🧪 Live AI Reply Tester</h3>
    <form id="simForm" style="display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; gap: 10px;">
        <select id="simContact" style="background: #0d1117; color: #e6edf3; border: 1px solid #30363d; padding: 8px; border-radius: 6px; flex: 1;">
          <option value="919347333478">Vishnuvardhan (+91 9347333478)</option>
          <option value="919182975891">Abhi Reddy (+91 9182975891)</option>
        </select>
        <input type="text" id="simName" value="Vishnu" style="background: #0d1117; color: #e6edf3; border: 1px solid #30363d; padding: 8px; border-radius: 6px; width: 100px;" placeholder="Name" />
      </div>
      <input type="text" id="simMsg" value="hello bro em chasthunav" style="background: #0d1117; color: #e6edf3; border: 1px solid #30363d; padding: 10px; border-radius: 6px; font-size: 14px;" placeholder="Type test message here..." />
      <button type="submit" style="background: #238636; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer;">🚀 Test Live Auto-Reply</button>
    </form>
    <div id="simResult" style="margin-top: 15px; display: none; background: #0d1117; border: 1px solid #30363d; padding: 12px; border-radius: 8px; font-size: 13px; font-family: monospace; color: #7ee787;"></div>
  </div>
</div>
<script>
  const el = document.getElementById('ts');
  const tick = () => el.textContent = new Date().toLocaleTimeString();
  tick(); setInterval(tick, 1000);

  document.getElementById('simForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resBox = document.getElementById('simResult');
    resBox.style.display = 'block';
    resBox.textContent = '⏳ Processing AI situational reply...';
    try {
      const from = document.getElementById('simContact').value;
      const name = document.getElementById('simName').value;
      const body = document.getElementById('simMsg').value;

      const res = await fetch('/v1/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [{
            changes: [{
              value: {
                contacts: [{ profile: { name } }],
                messages: [{ from, text: { body } }]
              }
            }]
          }]
        })
      });
      const data = await res.text();
      resBox.textContent = '✅ Replied Successfully! Check server console log for generated reply.';
    } catch (err) {
      resBox.textContent = '❌ Error: ' + err.message;
    }
  });
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

import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { setQR, setStatus } from '../state';
import { PiiRedactor } from '../privacy/piiRedactor';
import { IntentClassifier } from '../classifiers/intentClassifier';
import { ContextAssembler } from '../memory/contextAssembler';
import { LLMGateway } from '../llm/llmGateway';
import { GuardrailValidator } from '../validator/guardrailValidator';
import { WhatsAppReviewQueue } from '../hitl/whatsappReview';
import { SituationalAnalyzer } from '../analytics/situationalAnalyzer';
import { BotLoopDetector } from '../privacy/botLoopDetector';
import { ConversationMemoryEngine } from '../memory/conversationMemory';
import { RealTypingBroadcaster } from './realTypingBroadcaster';
import { ContactQueueManager } from './contactQueue';
import { config } from '../config';

export class WhatsAppNativeClient {
  private client: Client;
  private classifier: IntentClassifier;
  private contextAssembler: ContextAssembler;
  private llmGateway: LLMGateway;
  private hitlQueue: WhatsAppReviewQueue;

  constructor(
    classifier: IntentClassifier,
    contextAssembler: ContextAssembler,
    llmGateway: LLMGateway,
    hitlQueue: WhatsAppReviewQueue
  ) {
    this.classifier = classifier;
    this.contextAssembler = contextAssembler;
    this.llmGateway = llmGateway;
    this.hitlQueue = hitlQueue;

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: './whatsapp_session' }),
      puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
        protocolTimeout: 60000, // Increase timeout to prevent Runtime.callFunctionOn timeout
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        ]
      }
    });
  }

  public async initialize(): Promise<void> {
    setStatus('disconnected');

    this.client.on('qr', (qr) => {
      setQR(qr);
      console.log('\n📱 SCAN QR: open http://localhost:3000/qr in your browser, OR scan below:\n');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('authenticated', () => {
      console.log('[WhatsApp] Authentication successful!');
    });

    this.client.on('ready', () => {
      setStatus('connected');
      setQR(null);
      console.log('\n✅ WHATSAPP CONNECTED — AI Agent is listening for messages.\n');

      // Auto-scan unread messages 5s after connection
      setTimeout(() => {
        this.processUnreadMessages();
      }, 5000);

      // Periodic unread check every 30s
      setInterval(() => {
        this.processUnreadMessages();
      }, 30000);
    });

    this.client.on('disconnected', () => {
      setStatus('disconnected');
      console.log('[WhatsApp] Disconnected.');
    });

    const processedIds = new Set<string>();

    const handleMsg = async (msg: Message) => {
      if (msg.fromMe || (!msg.body && !msg.hasMedia && !(msg as any).type)) return;
      if (processedIds.has(msg.id._serialized)) return;
      processedIds.add(msg.id._serialized);

      // Keep set size manageable
      if (processedIds.size > 500) {
        const first = processedIds.values().next().value;
        if (first) processedIds.delete(first);
      }

      const rawFrom = typeof msg.from === 'string' ? msg.from : ((msg.from as any)?._serialized || '');
      const remoteJid = await this.resolveRealJid(rawFrom, msg);

      console.log(`\n🔔 [NEW MESSAGE DETECTED] From: ${msg.from} | Body: "${msg.body}"`);
      await ContactQueueManager.enqueue(remoteJid, msg, (m) => this.processIncomingMessage(m));
    };

    this.client.on('message', handleMsg);
    this.client.on('message_create', handleMsg);

    try {
      await this.client.initialize();
    } catch (err) {
      console.warn('⚠️ [WhatsApp Engine] Connection init note:', (err as Error).message);
    }
  }

  /**
   * Finds a chat by name/query and sends an AI generated contextual reply to their last message.
   */
  public async sendToContact(query: string, textOverride?: string): Promise<boolean> {
    try {
      const chats = await this.client.getChats();
      const targetChat = chats.find(c =>
        (c.name && c.name.toLowerCase().includes(query.toLowerCase())) ||
        (c.id?._serialized && c.id._serialized.includes(query))
      );

      if (!targetChat) {
        console.log(`[sendToContact] No chat found matching "${query}"`);
        return false;
      }

      let replyText = textOverride;
      if (!replyText) {
        const msgs = await targetChat.fetchMessages({ limit: 5 });
        const lastMsg = msgs.reverse().find(m => !m.fromMe && m.body);
        const rawText = lastMsg ? lastMsg.body : 'Hello';
        const contact = await targetChat.getContact();
        const pushName = contact.pushname || contact.name || query;

        console.log(`[sendToContact] Generating AI reply for ${pushName}'s last message: "${rawText}"`);

        const systemPrompt = `You are a friendly, warm WhatsApp team member replying to a customer.
Keep it natural, concise (1-2 sentences), professional and helpful.
Max 1 emoji. Output ONLY JSON: {"reply_text":"..."}`;

        const llmResponse = await this.llmGateway.generateCompletion(
          systemPrompt,
          `${pushName} says: "${rawText}"`
        );

        replyText = llmResponse.jsonOutput?.reply_text || llmResponse.rawText || `Hey ${pushName}! Thanks for reaching out. How can I help you today? 😊`;
      }

      if (!replyText) return false;

      await targetChat.sendMessage(replyText);
      console.log(`✅ [Sent to ${targetChat.name}] "${replyText}"`);
      return true;
    } catch (err) {
      console.error(`[sendToContact Error]`, err);
      return false;
    }
  }

  /**
   * Scans all unread WhatsApp chats, analyzes unread messages, and auto-replies.
   */
  public async processUnreadMessages(): Promise<number> {
    try {
      console.log('\n🔎 [UNREAD SCANNER] Checking for unread chats...');

      if (!this.client || !(this.client as any).pupPage || !(this.client as any).info) {
        console.log('🔎 [UNREAD SCANNER] WhatsApp Web engine is initializing... waiting for full readiness.');
        return 0;
      }

      let chats: any[] = [];
      try {
        chats = await this.client.getChats();
      } catch (getChatsErr) {
        try {
          const pupPage = (this.client as any).pupPage;
          if (pupPage) {
            const rawList: any[] = await pupPage.evaluate(() => {
              const Store = (window as any).Store;
              if (!Store || !Store.Chat) return [];
              const models = Store.Chat.getModelsArray ? Store.Chat.getModelsArray() : Store.Chat.models || [];
              return models.map((c: any) => ({
                id: c.id ? (c.id._serialized || c.id) : '',
                name: c.name || c.formattedTitle || c.contact?.pushname || 'Friend',
                unreadCount: c.unreadCount || c.unreadMsgs || 0,
                isGroup: c.isGroup || (c.id && (c.id.server === 'g.us' || c.id._serialized?.includes('@g.us'))),
                isReadOnly: c.isReadOnly || false
              }));
            });

            for (const item of rawList) {
              if (item.id && item.unreadCount > 0 && !item.isGroup && !item.isReadOnly) {
                try {
                  const chatObj = await this.client.getChatById(item.id);
                  if (chatObj) chats.push(chatObj);
                } catch { /* ignore */ }
              }
            }
          }
        } catch { /* ignore */ }
      }

      console.log(`🔎 [UNREAD SCANNER] Total chats in WhatsApp: ${chats.length}`);

      const unreadChats = chats.filter(c => {
        if (!c || c.isGroup || c.isReadOnly) return false;
        const count = c.unreadCount || (c as any).unreadMsgs || (c as any).unread || 0;
        const hasUnreadFlag = (c as any).hasUnread || false;
        return count > 0 || hasUnreadFlag;
      });
      console.log(`🔎 [UNREAD SCANNER] Found ${unreadChats.length} unread 1-on-1 chat(s):`, unreadChats.map(c => `${c.name || c.id._serialized} (unread: ${c.unreadCount || (c as any).unreadMsgs || 0})`).join(', '));

      if (unreadChats.length === 0) {
        console.log('🔎 [UNREAD SCANNER] No unread individual messages found.');
        return 0;
      }

      let processedCount = 0;
      for (const chat of unreadChats) {
        try {
          const fetchLimit = Math.max(chat.unreadCount || (chat as any).unreadMsgs || 1, 5);
          const msgs = await chat.fetchMessages({ limit: fetchLimit });
          const incomingMsgs = msgs.filter((m: Message) => !m.fromMe && (m.body || m.hasMedia));

          if (incomingMsgs.length > 0) {
            const lastMsg = incomingMsgs[incomingMsgs.length - 1];
            console.log(`📩 [UNREAD MATCH] Processing unread message from ${chat.name || chat.id._serialized}: "${lastMsg.body || '[Media/Photo]'}"`);
            await this.processIncomingMessage(lastMsg);
            try {
              await chat.sendSeen();
            } catch { /* ignore seen errors */ }
            processedCount++;
          }
        } catch (chatErr) {
          console.warn(`[UNREAD SCANNER] Could not fetch messages for ${chat.name}:`, (chatErr as Error).message);
        }
      }

      console.log(`✅ [UNREAD SCANNER] Successfully processed & replied to ${processedCount} unread message(s).\n`);
      return processedCount;
    } catch (err) {
      let errMsg = String(err);
      if (err && typeof err === 'object') {
        errMsg = (err as any).stack || (err as any).message || JSON.stringify(err);
      }
      console.warn('[UNREAD SCANNER Note]', errMsg);
      return 0;
    }
  }

  /**
   * Debug helper to inspect all active chats directly in WhatsApp Web memory.
   */
  public async getAllChatsDebug(): Promise<any[]> {
    try {
      try {
        await this.client.getChats();
      } catch { /* ignore */ }

      const pupPage = (this.client as any).pupPage;
      if (!pupPage) return [];

      return await pupPage.evaluate(async () => {
        try {
          const Store = (window as any).Store;
          const models = Store && Store.Chat ? (Store.Chat.getModelsArray ? Store.Chat.getModelsArray() : Store.Chat.models || []) : [];
          return models.map((c: any) => ({
            id: c.id ? (c.id._serialized || c.id) : '',
            name: c.name || c.formattedTitle || c.contact?.pushname || 'Unknown',
            unreadCount: c.unreadCount ?? c.unreadMsgs ?? 0,
            hasUnread: c.hasUnread ?? false,
            isGroup: c.isGroup || (c.id && (c.id.server === 'g.us' || c.id._serialized?.includes('@g.us'))),
            lastMsgText: c.msgs && c.msgs.last ? c.msgs.last.body : ''
          }));
        } catch (e) {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  /**
   * Sends a message by phone JID — used only for HITL draft approvals
   * where we need to send to a stored contact (not as a reply).
   */
  public async sendTextMessage(remoteJid: string, text: string): Promise<boolean> {
    try {
      let formattedJid = remoteJid.trim();

      if (formattedJid.endsWith('@lid')) {
        try {
          const res = await (this.client as any).getContactLidAndPhone([formattedJid]);
          if (res && res[0] && res[0].pn) {
            formattedJid = res[0].pn;
          }
        } catch { /* ignore */ }
      }

      if (!formattedJid.includes('@')) {
        formattedJid = `${formattedJid}@c.us`;
      }
      if (!formattedJid.endsWith('@c.us') && !formattedJid.endsWith('@s.whatsapp.net')) {
        formattedJid = `${formattedJid.replace(/@.*$/, '')}@c.us`;
      }

      await this.client.sendMessage(formattedJid, text);
      console.log(`✅ [Sent via WhatsApp API] To ${formattedJid}: "${text.slice(0, 80)}"`);
      return true;
    } catch (err) {
      console.error(`❌ [Send Error] To ${remoteJid}:`, (err as Error).message);
      return false;
    }
  }

  /**
   * Resolves a WhatsApp JID (converts @lid linked device IDs to standard @c.us phone JIDs).
   */
  private async resolveRealJid(jid: string, msg?: Message): Promise<string> {
    if (!jid) return jid;

    if (jid.endsWith('@c.us') || jid.endsWith('@s.whatsapp.net')) {
      return jid;
    }

    if (msg) {
      const data = (msg as any)._data;
      if (data) {
        if (typeof data.id?.remote === 'string' && data.id.remote.endsWith('@c.us')) return data.id.remote;
        if (typeof data.from === 'string' && data.from.endsWith('@c.us')) return data.from;
        if (typeof data.author === 'string' && data.author.endsWith('@c.us')) return data.author;
      }
    }

    if (jid.endsWith('@lid')) {
      try {
        const res = await (this.client as any).getContactLidAndPhone([jid]);
        if (res && res[0] && res[0].pn) {
          const pn = res[0].pn.endsWith('@c.us') ? res[0].pn : `${res[0].pn}@c.us`;
          console.log(`[JID Resolved] Converted ${jid} -> ${pn}`);
          return pn;
        }
      } catch (err) {
        console.warn(`[JID Resolve Fallback] Could not map ${jid} via getContactLidAndPhone.`);
      }
    }

    return jid;
  }

  /**
   * Main incoming message pipeline.
   */
  private async processIncomingMessage(msg: Message): Promise<void> {
    if (msg.fromMe) return;
    if (msg.from === 'status@broadcast' || msg.from.endsWith('@g.us') || msg.from.endsWith('@newsletter')) return;

    const hasMedia = Boolean(msg.hasMedia || (msg as any).type === 'image' || (msg as any).type === 'sticker');
    let rawText = (msg.body || '').trim();

    if (hasMedia) {
      if (!rawText) {
        rawText = '[User sent a photo/image]';
      } else {
        rawText = `[User sent a photo/image with caption: "${rawText}"]`;
      }
    }

    if (!rawText) {
      const msgType = (msg as any).type || 'message';
      if (msgType === 'audio' || msgType === 'ptt') {
        rawText = '[User sent a voice note / audio message]';
      } else if (msgType === 'location') {
        rawText = '[User shared their location]';
      } else if (msgType === 'vcard' || msgType === 'contact_card') {
        rawText = '[User shared a contact card]';
      } else if (msgType === 'document') {
        rawText = '[User sent a document/file]';
      } else if (msgType === 'sticker') {
        rawText = '[User sent a sticker]';
      } else {
        rawText = '[User sent a message]';
      }
    }

    // Resolve LID -> phone JID safely
    const rawFrom = typeof msg.from === 'string' ? msg.from : ((msg.from as any)?._serialized || '');
    const remoteJid = await this.resolveRealJid(rawFrom, msg);

    // Get pushname directly from message data — avoids calling msg.getContact() which can throw
    const pushName = (msg as any)._data?.notifyName || (msg as any)._data?.pushname || 'there';

    console.log(`\n📩 [MSG] From: ${pushName} (${remoteJid}) | "${rawText}"`);

    // ── Anti-Bot Infinite Loop Safeguard ───────────────────────────────────────
    const botCheck = BotLoopDetector.shouldSuppressForBotLoop(remoteJid, rawText);
    if (botCheck.isBotLoop) {
      console.log(`🤖 [BOT LOOP PREVENTED] Suppressed auto-reply for ${pushName} (${remoteJid}): ${botCheck.reason}`);
      return;
    }

    // ── ⚡ Broadcast Instant WhatsApp "Typing..." Indicator ──────────────────────
    const pupPage = (this.client as any).pupPage;
    let chat: any = undefined;
    try {
      chat = await msg.getChat();
    } catch { /* ignore */ }
    await RealTypingBroadcaster.startTyping(chat, pupPage, remoteJid);

    // ── Owner Command Handler ──────────────────────────────────────────────────
    const ownerDigits = (config.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
    const remoteDigits = remoteJid.replace(/\D/g, '');
    const isOwner = Boolean(ownerDigits && remoteDigits.includes(ownerDigits));

    if (isOwner && /^(approve|edit|reject)\s+draft_/i.test(rawText)) {
      if (/^approve\s+(draft_\w+)/i.test(rawText)) {
        const draftId = rawText.match(/^approve\s+(draft_\w+)/i)?.[1] ?? '';
        const draft = this.hitlQueue.getDraft(draftId);
        if (draft) {
          await this.sendTextMessage(draft.remoteJid, draft.draftReply);
          this.hitlQueue.removeDraft(draftId);
          await msg.reply(`✅ Sent reply to ${draft.customerName}!`);
        } else {
          await msg.reply(`⚠️ Draft ${draftId} not found.`);
        }
        return;
      }
      if (/^edit\s+(draft_\w+)\s+(.+)/is.test(rawText)) {
        const m = rawText.match(/^edit\s+(draft_\w+)\s+(.+)/is);
        const draft = m ? this.hitlQueue.getDraft(m[1]) : null;
        if (draft && m?.[2]) {
          await this.sendTextMessage(draft.remoteJid, m[2]);
          this.hitlQueue.removeDraft(m[1]);
          await msg.reply(`✅ Custom reply sent to ${draft.customerName}!`);
        } else {
          await msg.reply(`⚠️ Draft not found or bad format.`);
        }
        return;
      }
      if (/^reject\s+(draft_\w+)/i.test(rawText)) {
        const draftId = rawText.match(/^reject\s+(draft_\w+)/i)?.[1] ?? '';
        this.hitlQueue.removeDraft(draftId);
        await msg.reply(`❌ Cancelled draft ${draftId}.`);
        return;
      }
    }

    // ── AI Pipeline ────────────────────────────────────────────────────────────
    try {
      const redaction = PiiRedactor.redact(rawText);
      const windowOpen = true;

      // Record user turn in multi-turn conversation memory
      ConversationMemoryEngine.addTurn(remoteJid, 'user', redaction.redactedText, pushName);

      // Hydrate past thread history directly from WhatsApp chat if available
      if (chat && typeof chat.fetchMessages === 'function') {
        try {
          const pastMsgs = await chat.fetchMessages({ limit: 10 });
          for (const m of pastMsgs) {
            if (m.body) {
              const role = m.fromMe ? 'assistant' : 'user';
              const sender = m.fromMe ? 'Me (AI)' : pushName;
              ConversationMemoryEngine.addTurn(remoteJid, role, m.body, sender);
            }
          }
        } catch { /* ignore */ }
      }

      const historyStr = ConversationMemoryEngine.getFormattedHistory(remoteJid);

      // 1. Situational Analysis with Relationship Tier
      const situation = SituationalAnalyzer.analyze(redaction.redactedText, pushName);
      console.log(`[SITUATION ANALYSIS] Dialect: ${situation.languageStyle} | Tier: ${situation.relationshipTier} | Tone: ${situation.relationshipTone} | Topic: ${situation.situationalTopic}`);
      console.log(`[HUMAN STRATEGY] ${situation.humanResponseStrategy}`);

      // Classify intent
      const classification = await this.classifier.classify(redaction.redactedText, windowOpen);
      // Assemble context
      const context = await this.contextAssembler.assembleContext(remoteJid, redaction.redactedText);

      // Generate reply with Deep Situational Context & Multi-Turn History
      const systemPrompt = `You are a real human responding on WhatsApp. Match the user's situation and tone EXACTLY.

SITUATION ANALYSIS FOR THIS MESSAGE:
- Customer Name: ${pushName}
- Relationship Tier: ${situation.relationshipTier}
- Detected Language/Dialect: ${situation.languageStyle}
- Relationship Tone: ${situation.relationshipTone}
- Emotional Mood: ${situation.detectedMood}
- Topic: ${situation.situationalTopic}
- Direct Question Asked: ${situation.isQuestion ? 'YES' : 'NO'}
- Link Shared: ${situation.hasLink ? 'YES' : 'NO'}
- Media Attached: ${situation.hasMedia ? 'YES' : 'NO'}
- Recommended Human Strategy: ${situation.humanResponseStrategy}

RECENT MULTI-TURN CHAT HISTORY WITH THIS CONTACT:
${historyStr}

RULES FOR CONTINUITY & CONTEXT:
- CRITICAL: You MUST read the previous messages and replies above and directly continue the exact conversation context!
- If the previous reply asked a question, respond directly to the user's answer to that previous question.
- Never act like a fresh bot that forgot what was said 10 seconds ago.
- Be 100% human, warm, natural, and direct.
- STRICT BAN on AI tropes ("As an AI", "Certainly!", "I am an automated assistant").
- Match the user's exact dialect (Romanized Telugu, Hinglish, or English).
- Maximum 1-2 short sentences. Max 1 emoji.
- Output ONLY valid JSON: {"reply_text":"...","confidence":0.95}

Context: ${context.formattedContext}`;

      const llmResponse = await this.llmGateway.generateCompletion(
        systemPrompt,
        `${pushName}: "${redaction.redactedText}"`
      );

      const generatedText = llmResponse.jsonOutput?.reply_text || llmResponse.rawText;
      const confidence = llmResponse.jsonOutput?.confidence ?? (classification.confidence > 0 ? classification.confidence : 0.9);
      console.log(`[AI] Confidence: ${confidence} | Reply: "${generatedText?.slice(0, 80)}"`);

      // Safety guardrail
      const decision = await GuardrailValidator.validateWithSafety(
        generatedText, confidence, classification.riskScore,
        classification.requiresHuman, windowOpen, this.llmGateway
      );

      const sendReply = async (text: string) => {
        try {
          await RealTypingBroadcaster.broadcastTypingStatus(text);
          await RealTypingBroadcaster.stopTyping(chat, pupPage, remoteJid);

          console.log(`[Sending Reply to ${pushName} (${remoteJid})] "${text.slice(0, 60)}..."`);

          let sent = false;
          if (chat && typeof chat.sendMessage === 'function') {
            try {
              await chat.sendMessage(text);
              sent = true;
              console.log(`✅ [Replied via chat.sendMessage]`);
            } catch { /* fallback */ }
          }

          if (!sent) {
            try {
              await msg.reply(text);
              sent = true;
              console.log(`✅ [Replied via msg.reply]`);
            } catch { /* fallback */ }
          }

          if (!sent) {
            await this.sendTextMessage(remoteJid, text);
          }

          // Record assistant turn in multi-turn memory
          ConversationMemoryEngine.addTurn(remoteJid, 'assistant', text, 'Me (AI)');
        } catch (replyErr) {
          console.warn(`[Reply dispatch fallback to ${remoteJid}]`, (replyErr as Error).message);
          await this.sendTextMessage(remoteJid, text);
        }
      };

      // Send
      if (decision.action === 'AUTO_SEND') {
        await sendReply(decision.finalText);
        console.log(`✅ [AUTO_SEND Complete] "${decision.finalText?.slice(0, 80)}"`);
      } else if (decision.action === 'DRAFT_FOR_REVIEW') {
        await this.hitlQueue.submitDraftForReview({
          id: `draft_${Date.now()}`, remoteJid, customerName: pushName,
          userMessage: rawText, intent: classification.intent,
          confidence, draftReply: decision.finalText, createdAt: new Date()
        });
        console.log(`📋 [Draft] Queued for owner approval`);
      } else {
        await sendReply(`Thanks ${pushName}! A teammate will follow up soon. 😊`);
      }

    } catch (err) {
      console.error(`[Pipeline Error]`, (err as Error).message);
      try {
        await msg.reply(`Sorry, hit a glitch! Someone will follow up with you.`);
      } catch { /* ignore */ }
    }
  }
}

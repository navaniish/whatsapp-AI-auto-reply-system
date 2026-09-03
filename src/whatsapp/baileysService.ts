import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { PiiRedactor } from '../privacy/piiRedactor';
import { IntentClassifier } from '../classifiers/intentClassifier';
import { ContextAssembler } from '../memory/contextAssembler';
import { LLMGateway } from '../llm/llmGateway';
import { GuardrailValidator } from '../validator/guardrailValidator';
import { WhatsAppReviewQueue } from '../hitl/whatsappReview';
import { config } from '../config';

export class BaileysWhatsAppService {
  private sock?: WASocket;
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
  }

  /**
   * Starts the direct Baileys WhatsApp connection with QR Code rendering in terminal.
   */
  public async startConnection(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We use custom qrcode-terminal rendering
      browser: ['AI Co-Pilot', 'Chrome', '1.0.0']
    });

    this.sock.ev.on('creds.update', saveCreds);

    // Connection updates (QR code display & reconnects)
    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n========================================================================');
        console.log('📱 SCAN THIS QR CODE WITH WHATSAPP ON YOUR PHONE:');
        console.log('1. Open WhatsApp on your mobile phone');
        console.log('2. Tap Settings / Menu -> Linked Devices -> Link a Device');
        console.log('========================================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\n========================================================================\n');
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Connection closed due to error. Reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          this.startConnection();
        }
      } else if (connection === 'open') {
        console.log('\n========================================================================');
        console.log('✅ WHATSAPP CONNECTED SUCCESSFULLY VIA BAILEYS NATIVE ENGINE!');
        console.log('AI Agent is now active and listening for live incoming messages.');
        console.log('========================================================================\n');
      }
    });

    // Inbound Messages Listener
    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;

      for (const msg of m.messages) {
        await this.processIncomingMessage(msg);
      }
    });
  }

  /**
   * Calculates realistic human typing delay based on message length.
   */
  private calculateTypingDelay(text: string): number {
    const baseDelay = 1500;
    const typingSpeedMsPerChar = 35;
    const jitter = Math.floor(Math.random() * 1200);
    const calculated = baseDelay + text.length * typingSpeedMsPerChar + jitter;
    return Math.min(Math.max(calculated, 2000), 7000);
  }

  /**
   * Sends a text message with simulated human typing presence.
   */
  public async sendTextMessage(remoteJid: string, text: string): Promise<boolean> {
    if (!this.sock) {
      console.error('WhatsApp socket is not connected yet.');
      return false;
    }

    try {
      const typingDelay = this.calculateTypingDelay(text);
      console.log(`[Humanized Behavior] Simulating typing for ${(typingDelay / 1000).toFixed(1)}s to ${remoteJid}...`);

      // 1. Show 'composing' typing indicator
      await this.sock.sendPresenceUpdate('composing', remoteJid);
      await new Promise((resolve) => setTimeout(resolve, typingDelay));

      // 2. Pause typing state
      await this.sock.sendPresenceUpdate('paused', remoteJid);

      // 3. Send text message
      await this.sock.sendMessage(remoteJid, { text });
      return true;
    } catch (err) {
      console.error(`Error sending message to ${remoteJid}:`, (err as Error).message);
      return false;
    }
  }

  /**
   * Processes incoming WhatsApp messages through the 8-step pipeline.
   */
  private async processIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    if (!msg.message || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    const pushName = msg.pushName || 'there';
    const rawText = msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!remoteJid || !rawText) return;

    const trimmedText = rawText.trim();

    // =========================================================================
    // WHATSAPP OWNER COMMAND HANDLER (Native WhatsApp Approval)
    // =========================================================================
    const ownerDigits = (config.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
    const remoteDigits = remoteJid.replace(/\D/g, '');
    const isOwner = Boolean(ownerDigits && remoteDigits.includes(ownerDigits));

    if (isOwner || /^(approve|edit|reject)\s+draft_/i.test(trimmedText)) {
      if (/^approve\s+(draft_\w+)/i.test(trimmedText)) {
        const match = trimmedText.match(/^approve\s+(draft_\w+)/i);
        const draftId = match ? match[1] : '';
        const draft = this.hitlQueue.getDraft(draftId);

        if (draft) {
          console.log(`[Owner Approval] Dispatching draft ${draftId} to ${draft.remoteJid}`);
          await this.sendTextMessage(draft.remoteJid, draft.draftReply);
          this.hitlQueue.removeDraft(draftId);
          await this.sendTextMessage(remoteJid, `✅ Sent message to ${draft.customerName}!`);
        } else {
          await this.sendTextMessage(remoteJid, `⚠️ Draft ${draftId} not found or already sent.`);
        }
        return;
      }

      if (/^edit\s+(draft_\w+)\s+(.+)/is.test(trimmedText)) {
        const match = trimmedText.match(/^edit\s+(draft_\w+)\s+(.+)/is);
        const draftId = match ? match[1] : '';
        const customReply = match ? match[2] : '';
        const draft = this.hitlQueue.getDraft(draftId);

        if (draft && customReply) {
          console.log(`[Owner Edit] Dispatching custom reply for draft ${draftId} to ${draft.remoteJid}`);
          await this.sendTextMessage(draft.remoteJid, customReply);
          this.hitlQueue.removeDraft(draftId);
          await this.sendTextMessage(remoteJid, `✅ Sent your custom response to ${draft.customerName}!`);
        } else {
          await this.sendTextMessage(remoteJid, `⚠️ Draft ${draftId} not found or invalid format.`);
        }
        return;
      }

      if (/^reject\s+(draft_\w+)/i.test(trimmedText)) {
        const match = trimmedText.match(/^reject\s+(draft_\w+)/i);
        const draftId = match ? match[1] : '';
        this.hitlQueue.removeDraft(draftId);
        await this.sendTextMessage(remoteJid, `❌ Cancelled draft ${draftId}.`);
        return;
      }
    }

    // =========================================================================
    // INBOUND CUSTOMER MESSAGE PIPELINE
    // =========================================================================
    console.log(`\n📩 [Inbound Message] From: ${pushName} (${remoteJid}): "${rawText}"`);

    // STEP 1: PII Redaction
    const redaction = PiiRedactor.redact(rawText);

    // STEP 2: Service Window Check
    const windowOpen = true;

    // STEP 3: Intent & Safety Classification (via NVIDIA NIM)
    const classification = await this.classifier.classify(redaction.redactedText, windowOpen);

    // STEP 4: Fast-Path Rule Override
    if (classification.ruleOverride && classification.requiresHuman) {
      console.log(`[Handoff Triggered] ${classification.handoffReason}`);
      const humanizedHandoff = `Hey ${pushName}! Sure thing, I'll connect you with a teammate right away so they can help you out directly. 👍`;
      await this.sendTextMessage(remoteJid, humanizedHandoff);
      return;
    }

    // STEP 5: Tiered RAG Context Assembly
    const context = await this.contextAssembler.assembleContext(remoteJid, redaction.redactedText);

    // STEP 6: Humanized LLM Generation (via NVIDIA NIM openai/gpt-oss-20b)
    const systemPrompt = `You are a real, warm, helpful team member replying to a customer on WhatsApp.

HUMAN PERSONA RULES:
1. Write naturally like a friendly, professional human texting on WhatsApp.
2. Keep it concise (1 to 3 short sentences max).
3. NEVER use robotic clichés like "Certainly!", "As an AI...", "Dear customer", or "I am delighted to assist you with...".
4. Emoji: Use 0 to 1 natural emoji max (e.g. 😊, 👋, 👍) if appropriate.
5. Answer strictly using ONLY the provided knowledge context.

Output ONLY valid JSON format:
{
  "reply_text": "string (the humanized message)",
  "confidence": float (0.0 to 1.0)
}

Knowledge Context:
${context.formattedContext}`;

    const llmResponse = await this.llmGateway.generateCompletion(
      systemPrompt,
      `Customer (${pushName}) says: "${redaction.redactedText}"`
    );

    const generatedText = llmResponse.jsonOutput?.reply_text || llmResponse.rawText;
    const confidence = llmResponse.jsonOutput?.confidence ?? classification.confidence;

    // STEP 7: Guardrail Validation & NVIDIA Content Safety Audit
    const decision = await GuardrailValidator.validateWithSafety(
      generatedText,
      confidence,
      classification.riskScore,
      classification.requiresHuman,
      windowOpen,
      this.llmGateway
    );

    // STEP 8: Dispatch Matrix
    if (decision.action === 'AUTO_SEND') {
      await this.sendTextMessage(remoteJid, decision.finalText);
    } else if (decision.action === 'DRAFT_FOR_REVIEW') {
      await this.hitlQueue.submitDraftForReview({
        id: `draft_${Date.now()}`,
        remoteJid,
        customerName: pushName,
        userMessage: rawText,
        intent: classification.intent,
        confidence,
        draftReply: decision.finalText,
        createdAt: new Date()
      });
    } else {
      const humanizedHandoff = `Thanks for reaching out, ${pushName}! A member of our team will get back to you personally in just a bit. 😊`;
      await this.sendTextMessage(remoteJid, humanizedHandoff);
    }
  }
}

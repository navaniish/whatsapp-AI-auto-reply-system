import { Request, Response } from 'express';
import { PiiRedactor } from '../privacy/piiRedactor';
import { IntentClassifier } from '../classifiers/intentClassifier';
import { ContextAssembler } from '../memory/contextAssembler';
import { LLMGateway } from '../llm/llmGateway';
import { GuardrailValidator } from '../validator/guardrailValidator';
import { EvolutionClient } from './evolutionClient';
import { WhatsAppReviewQueue } from '../hitl/whatsappReview';
import { config } from '../config';

export class WebhookHandler {
  private classifier: IntentClassifier;
  private contextAssembler: ContextAssembler;
  private llmGateway: LLMGateway;
  private evolutionClient: EvolutionClient;
  private hitlQueue: WhatsAppReviewQueue;

  constructor(
    classifier: IntentClassifier,
    contextAssembler: ContextAssembler,
    llmGateway: LLMGateway,
    evolutionClient: EvolutionClient,
    hitlQueue: WhatsAppReviewQueue
  ) {
    this.classifier = classifier;
    this.contextAssembler = contextAssembler;
    this.llmGateway = llmGateway;
    this.evolutionClient = evolutionClient;
    this.hitlQueue = hitlQueue;
  }

  /**
   * Main Webhook Endpoint for Evolution API / WhatsApp Web events.
   */
  public handleWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = req.body;
      const data = payload?.data;
      if (!data) {
        res.status(200).json({ status: 'ignored', reason: 'no data in payload' });
        return;
      }

      // Ignore outbound messages sent by the owner/bot itself unless it's an explicit command
      if (data.key?.fromMe) {
        res.status(200).json({ status: 'ignored', reason: 'outbound message from self' });
        return;
      }

      const remoteJid = data.key?.remoteJid;
      const pushName = data.pushName || 'there';
      const rawText = data.message?.conversation || data.message?.extendedTextMessage?.text;

      if (!remoteJid || !rawText) {
        res.status(200).json({ status: 'ignored', reason: 'empty message or JID missing' });
        return;
      }

      const trimmedText = rawText.trim();

      // =========================================================================
      // WHATSAPP OWNER COMMAND HANDLER (Native WhatsApp Human-In-The-Loop Approval)
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
            console.log(`[Owner WhatsApp Approval] Approved draft ${draftId} for ${draft.remoteJid}`);
            await this.evolutionClient.sendTextMessage(draft.remoteJid, draft.draftReply);
            this.hitlQueue.removeDraft(draftId);
            await this.evolutionClient.sendTextMessage(remoteJid, `✅ Sent message to ${draft.customerName}!`);
          } else {
            await this.evolutionClient.sendTextMessage(remoteJid, `⚠️ Draft ${draftId} not found or already sent.`);
          }
          res.status(200).json({ status: 'processed', action: 'OWNER_APPROVE' });
          return;
        }

        if (/^edit\s+(draft_\w+)\s+(.+)/is.test(trimmedText)) {
          const match = trimmedText.match(/^edit\s+(draft_\w+)\s+(.+)/is);
          const draftId = match ? match[1] : '';
          const customReply = match ? match[2] : '';
          const draft = this.hitlQueue.getDraft(draftId);

          if (draft && customReply) {
            console.log(`[Owner WhatsApp Edit] Edited draft ${draftId} for ${draft.remoteJid}`);
            await this.evolutionClient.sendTextMessage(draft.remoteJid, customReply);
            this.hitlQueue.removeDraft(draftId);
            await this.evolutionClient.sendTextMessage(remoteJid, `✅ Sent your custom response to ${draft.customerName}!`);
          } else {
            await this.evolutionClient.sendTextMessage(remoteJid, `⚠️ Draft ${draftId} not found or invalid format.`);
          }
          res.status(200).json({ status: 'processed', action: 'OWNER_EDIT' });
          return;
        }

        if (/^reject\s+(draft_\w+)/i.test(trimmedText)) {
          const match = trimmedText.match(/^reject\s+(draft_\w+)/i);
          const draftId = match ? match[1] : '';
          this.hitlQueue.removeDraft(draftId);
          await this.evolutionClient.sendTextMessage(remoteJid, `❌ Cancelled draft ${draftId}.`);
          res.status(200).json({ status: 'processed', action: 'OWNER_REJECT' });
          return;
        }
      }

      // =========================================================================
      // INBOUND CUSTOMER MESSAGE PIPELINE
      // =========================================================================
      console.log(`[Inbound WhatsApp Msg] From: ${pushName} (${remoteJid}): "${rawText}"`);

      // STEP 1: PII Redaction
      const redaction = PiiRedactor.redact(rawText);

      // STEP 2: Service Window Check
      const windowOpen = true;

      // STEP 3: Intent & Safety Classification (via meta/llama-3.1-8b-instruct)
      const classification = await this.classifier.classify(redaction.redactedText, windowOpen);

      // STEP 4: Fast-Path Rule Override (Opt-out / Human Request)
      if (classification.ruleOverride && classification.requiresHuman) {
        console.log(`[Handoff Triggered] ${classification.handoffReason}`);
        const humanizedHandoff = `Hey ${pushName}! Sure thing, I'll connect you with a teammate right away so they can help you out directly. 👍`;
        await this.evolutionClient.sendTextMessage(remoteJid, humanizedHandoff);
        res.status(200).json({ status: 'processed', action: 'HANDOFF_PAUSE' });
        return;
      }

      // STEP 5: Tiered RAG Context Assembly
      const context = await this.contextAssembler.assembleContext(remoteJid, redaction.redactedText);

      // STEP 6: Humanized LLM Generation (via openai/gpt-oss-20b)
      const systemPrompt = `You are a real, warm, helpful team member replying to a customer on WhatsApp.

HUMAN PERSONA RULES:
1. Write naturally like a friendly, professional human texting on WhatsApp.
2. Keep it concise (1 to 3 short sentences max).
3. NEVER use robotic clichés or generic bot intros like "Certainly!", "As an AI...", "Dear customer", or "I am delighted to assist you with...".
4. Emoji: Use 0 to 1 natural emoji max (e.g. 😊, 👋, 👍) if appropriate.
5. Answer strictly using ONLY the provided knowledge context. Never fabricate discounts, prices, or guarantees.

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
        const sendSuccess = await this.evolutionClient.sendTextMessage(remoteJid, decision.finalText);
        res.status(200).json({ status: 'processed', action: 'AUTO_SEND', success: sendSuccess });
        return;
      } else if (decision.action === 'DRAFT_FOR_REVIEW') {
        // Queue draft and send approval request directly to Owner's WhatsApp
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
        res.status(200).json({ status: 'processed', action: 'WHATSAPP_DRAFT_QUEUED' });
        return;
      } else {
        const humanizedHandoff = `Thanks for reaching out, ${pushName}! A member of our team will get back to you personally in just a bit. 😊`;
        await this.evolutionClient.sendTextMessage(remoteJid, humanizedHandoff);
        res.status(200).json({ status: 'processed', action: 'MANDATORY_HANDOFF' });
        return;
      }
    } catch (error) {
      console.error('Error handling webhook:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}

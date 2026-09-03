import { LLMGateway } from './llm/llmGateway';
import { IntentClassifier } from './classifiers/intentClassifier';
import { ContextAssembler } from './memory/contextAssembler';
import { GuardrailValidator } from './validator/guardrailValidator';
import { PiiRedactor } from './privacy/piiRedactor';

async function runHumanizedNvidiaTest() {
  console.log('========================================================================');
  console.log('🚀 TESTING LIVE HUMANIZED WHATSAPP AI AGENT (NVIDIA NIM PIPELINE)');
  console.log('========================================================================\n');

  const llm = new LLMGateway();
  const classifier = new IntentClassifier(llm);
  const contextAssembler = new ContextAssembler();

  const testInquiries = [
    { name: 'Sarah', msg: 'Hi! What time are you open tomorrow?' },
    { name: 'Michael', msg: 'How long does standard shipping take?' }
  ];

  for (const inquiry of testInquiries) {
    console.log(`------------------------------------------------------------------------`);
    console.log(`📩 Inbound WhatsApp Message from ${inquiry.name}: "${inquiry.msg}"`);

    // 1. PII Redaction
    const pii = PiiRedactor.redact(inquiry.msg);

    // 2. Classification via Llama 3.1 8B Instruct
    const classification = await classifier.classify(pii.redactedText, true);

    // 3. RAG Context Assembly
    const context = await contextAssembler.assembleContext('cust_human_01', pii.redactedText);

    // 4. Humanized Reply Generation via GPT-OSS-20B
    const systemPrompt = `You are a real, warm, helpful team member replying to a customer on WhatsApp.

HUMAN PERSONA RULES:
1. Write naturally like a friendly, professional human texting on WhatsApp.
2. Keep it concise (1 to 2 short sentences max).
3. NEVER use robotic clichés like "Certainly!", "As an AI...", "Dear customer", or "I am delighted to assist you with...".
4. Emoji: Use 0 to 1 natural emoji max (e.g. 😊, 👋, 👍) if appropriate.
5. Answer strictly using ONLY the provided knowledge context.

Output strictly in valid JSON format:
{
  "reply_text": "string (the humanized message)",
  "confidence": float (0.0 to 1.0)
}

Knowledge Context:
${context.formattedContext}`;

    const llmResp = await llm.generateCompletion(systemPrompt, `Customer (${inquiry.name}) says: "${pii.redactedText}"`, true);
    const replyText = llmResp.jsonOutput?.reply_text || llmResp.rawText;
    const confidence = llmResp.jsonOutput?.confidence ?? classification.confidence;

    console.log(`\n💬 Humanized Generated Reply:\n"${replyText.trim()}"`);

    // 5. Safety & Decision Validation
    const decision = await GuardrailValidator.validateWithSafety(
      replyText,
      confidence,
      classification.riskScore,
      classification.requiresHuman,
      true,
      llm
    );

    console.log(`⚡ Action Matrix: [${decision.action}] | Grounded: ${decision.grounded ? 'Yes' : 'No'}\n`);
  }

  console.log('========================================================================');
  console.log('✅ HUMANIZED MESSAGING VERIFICATION COMPLETE');
  console.log('========================================================================');
}

runHumanizedNvidiaTest();

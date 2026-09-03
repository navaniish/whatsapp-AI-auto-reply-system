import { PiiRedactor } from './privacy/piiRedactor';
import { LLMGateway } from './llm/llmGateway';
import { IntentClassifier } from './classifiers/intentClassifier';
import { ContextAssembler } from './memory/contextAssembler';
import { GuardrailValidator } from './validator/guardrailValidator';

async function runSimulation() {
  console.log('=== RUNNING PERSONAL WHATSAPP NATIVE AI AGENT SIMULATION ===\n');

  const llm = new LLMGateway();
  const classifier = new IntentClassifier(llm);
  const contextAssembler = new ContextAssembler();

  const testMessages = [
    { name: 'Alice', msg: 'Hi! What are your business operating hours?' },
    { name: 'Bob', msg: 'Can I get a 100% refund immediately or speak to a human?' },
    { name: 'Charlie', msg: 'My phone number is +1-555-0199 and email test@example.com. Can you check my order?' },
    { name: 'Dave', msg: 'STOP sending me messages!' }
  ];

  for (const test of testMessages) {
    console.log(`\n--------------------------------------------------`);
    console.log(`📩 Simulated Customer Message from ${test.name}: "${test.msg}"`);

    // 1. PII Masking
    const piiResult = PiiRedactor.redact(test.msg);
    console.log(`1. Redacted Text: "${piiResult.redactedText}"`);

    // 2. Intent Classification
    const classification = await classifier.classify(piiResult.redactedText, true);
    console.log(`2. Intent: ${classification.intent} | Risk: ${classification.riskScore} | Requires Human: ${classification.requiresHuman}`);

    if (classification.ruleOverride) {
      console.log(`   ⚡ RULE OVERRIDE TRIGGERED: ${classification.handoffReason}`);
      continue;
    }

    // 3. RAG Context Assembly
    const context = await contextAssembler.assembleContext('user_123', piiResult.redactedText);

    // 4. LLM Generation
    const llmResp = await llm.generateCompletion('System Prompt...', piiResult.redactedText);
    const replyText = llmResp.jsonOutput?.reply_text || llmResp.rawText;
    const confidence = llmResp.jsonOutput?.confidence || classification.confidence;

    // 5. Guardrail Decision
    const decision = GuardrailValidator.validate(
      replyText,
      confidence,
      classification.riskScore,
      classification.requiresHuman,
      true
    );

    console.log(`3. Generated Reply: "${replyText}"`);
    console.log(`4. Final Action: [${decision.action}] - Reason: ${decision.reason}`);
    
    if (decision.action === 'DRAFT_FOR_REVIEW') {
      console.log(`   📲 WHATSAPP ALERT SENT TO OWNER: "approve draft_101", "edit draft_101 <text>", or "reject draft_101"`);
    }
  }

  console.log('\n=== SIMULATION COMPLETE ===');
}

runSimulation();

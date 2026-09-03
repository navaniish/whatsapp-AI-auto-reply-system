export interface MessageTurn {
  role: 'user' | 'assistant';
  body: string;
  timestamp: string;
}

export interface CustomerFact {
  key: string;
  value: string;
  provenance: string;
}

export interface KnowledgeChunk {
  id: string;
  title: string;
  content: string;
  trustScore: number;
}

export interface ContextPacket {
  recentTurns: MessageTurn[];
  customerFacts: CustomerFact[];
  knowledgeChunks: KnowledgeChunk[];
  formattedContext: string;
}

export class ContextAssembler {
  /**
   * Composes a minimal-necessary context packet for reply generation.
   */
  public async assembleContext(
    customerId: string,
    queryText: string,
    history: MessageTurn[] = []
  ): Promise<ContextPacket> {
    // 1. Working Memory (Last N turns)
    const recentTurns = history.slice(-6);

    // 2. Customer Memory (Explicit facts)
    const customerFacts: CustomerFact[] = [
      { key: 'preferred_language', value: 'en', provenance: 'user_setting' }
    ];

    // 3. Knowledge Base RAG Search (Mock / Vector Store)
    const knowledgeChunks: KnowledgeChunk[] = [
      {
        id: 'faq_hours_01',
        title: 'Business Operating Hours',
        content: 'Our support team is available Monday through Friday from 9:00 AM to 6:00 PM EST.',
        trustScore: 1.0
      },
      {
        id: 'faq_shipping_02',
        title: 'Shipping Policy',
        content: 'Standard shipping takes 3-5 business days. Tracking links are sent via email.',
        trustScore: 0.95
      }
    ];

    // Format into prompt-friendly context snippet
    const historySnippet = recentTurns
      .map((t) => `${t.role === 'user' ? 'Customer' : 'Agent'}: ${t.body}`)
      .join('\n');

    const factsSnippet = customerFacts
      .map((f) => `- ${f.key}: ${f.value}`)
      .join('\n');

    const knowledgeSnippet = knowledgeChunks
      .map((k) => `[Source: ${k.title}] ${k.content}`)
      .join('\n');

    const formattedContext = `=== CONVERSATION HISTORY ===
${historySnippet || 'No prior history.'}

=== KNOWN CUSTOMER FACTS ===
${factsSnippet}

=== APPROVED KNOWLEDGE BASE ===
${knowledgeSnippet}`;

    return {
      recentTurns,
      customerFacts,
      knowledgeChunks,
      formattedContext
    };
  }
}

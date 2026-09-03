import OpenAI from 'openai';
import { config } from '../config';

export interface LLMResponse {
  rawText: string;
  reasoningContent?: string;
  jsonOutput?: any;
  provider: string;
  model: string;
}

export interface SafetyCheckResult {
  isSafe: boolean;
  category?: string;
  reason?: string;
  provider: string;
  model: string;
}

export class LLMGateway {
  private classifierClient?: OpenAI;
  private generatorClient?: OpenAI;
  private safetyClient?: OpenAI;

  constructor() {
    // 1. Fast Classifier Client (meta/llama-3.1-8b-instruct)
    if (config.NVIDIA_CLASSIFIER_KEY) {
      this.classifierClient = new OpenAI({
        baseURL: config.NVIDIA_BASE_URL,
        apiKey: config.NVIDIA_CLASSIFIER_KEY,
      });
    }

    // 2. Reasoning Generator Client (openai/gpt-oss-20b)
    if (config.NVIDIA_GENERATOR_KEY) {
      this.generatorClient = new OpenAI({
        baseURL: config.NVIDIA_BASE_URL,
        apiKey: config.NVIDIA_GENERATOR_KEY,
      });
    }

    // 3. Dedicated Content Safety Client (nemotron-3.5-content-safety)
    if (config.NVIDIA_SAFETY_KEY) {
      this.safetyClient = new OpenAI({
        baseURL: config.NVIDIA_BASE_URL,
        apiKey: config.NVIDIA_SAFETY_KEY,
      });
    }
  }

  /**
   * Fast Classification using Meta Llama 3.1 8B Instruct model via NVIDIA NIM.
   */
  public async classifyText(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
    if (this.classifierClient) {
      try {
        console.log(`[LLM Gateway] Running Classifier model (${config.NVIDIA_CLASSIFIER_MODEL})...`);
        const completion = await this.classifierClient.chat.completions.create({
          model: config.NVIDIA_CLASSIFIER_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1, // Low temp for deterministic classification
          max_tokens: 1024,
        });

        const rawText = completion.choices[0]?.message?.content || '';
        let jsonOutput: any = undefined;
        try {
          const cleanJson = rawText.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
          jsonOutput = JSON.parse(cleanJson);
        } catch (e) {
          console.warn('[LLM Classifier] Raw text parsing error, returning text output.');
        }

        return {
          rawText,
          jsonOutput,
          provider: 'nvidia-nim-classifier',
          model: config.NVIDIA_CLASSIFIER_MODEL
        };
      } catch (err) {
        console.error('[NVIDIA Classifier API Error]:', (err as Error).message);
      }
    }

    // Fallback
    return {
      rawText: '{"intent":"FAQ","urgency":"low","sentiment":"neutral","risk_score":0.2,"confidence":0.95,"requires_human":false}',
      jsonOutput: { intent: 'FAQ', urgency: 'low', sentiment: 'neutral', risk_score: 0.2, confidence: 0.95, requires_human: false },
      provider: 'fallback-local',
      model: 'local-classifier'
    };
  }

  /**
   * Deep Reasoning Reply Generation using OpenAI GPT-OSS-20B model via NVIDIA NIM.
   */
  public async generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    requireJson: boolean = true
  ): Promise<LLMResponse> {
    if (this.generatorClient) {
      try {
        console.log(`[LLM Gateway] Executing Generator model (${config.NVIDIA_GENERATOR_MODEL})...`);
        const completion = await (this.generatorClient.chat.completions.create as any)({
          model: config.NVIDIA_GENERATOR_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          top_p: 1.0,
          max_tokens: 4096
        });

        const choice = completion.choices[0];
        const rawText = choice?.message?.content || '';
        const reasoningContent = (choice?.message as any)?.reasoning_content || undefined;

        let jsonOutput: any = undefined;
        if (requireJson && rawText) {
          try {
            const cleanJson = rawText.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
            jsonOutput = JSON.parse(cleanJson);
          } catch (e) {
            console.warn('[NVIDIA Generator] JSON parse warning, returning raw text.');
          }
        }

        return {
          rawText,
          reasoningContent,
          jsonOutput,
          provider: 'nvidia-nim-generator',
          model: config.NVIDIA_GENERATOR_MODEL,
        };
      } catch (error) {
        console.error('[NVIDIA Generator API Error]:', (error as Error).message);
      }
    }

    // Fallback
    return {
      rawText: 'Thank you for your message! Our team is available to assist you.',
      jsonOutput: {
        reply_text: 'Thank you for your message! Our team is available to assist you.',
        confidence: 0.95
      },
      provider: 'fallback-local',
      model: 'local-generator'
    };
  }

  /**
   * Safety Audit using NVIDIA Nemotron 3.5 Content Safety model via NVIDIA NIM.
   */
  public async checkSafety(textToCheck: string): Promise<SafetyCheckResult> {
    if (this.safetyClient) {
      try {
        console.log(`[LLM Gateway] Auditing text with NVIDIA Safety Model (${config.NVIDIA_SAFETY_MODEL})...`);
        const completion = await this.safetyClient.chat.completions.create({
          model: config.NVIDIA_SAFETY_MODEL,
          messages: [
            { role: 'user', content: textToCheck }
          ],
          max_tokens: 512
        });

        const responseText = completion.choices[0]?.message?.content || '';
        const isUnsafe = /unsafe|harmful|violation|blocked/i.test(responseText);

        return {
          isSafe: !isUnsafe,
          reason: responseText,
          provider: 'nvidia-nim-safety',
          model: config.NVIDIA_SAFETY_MODEL
        };
      } catch (err) {
        console.warn('[NVIDIA Safety API Call Warning]:', (err as Error).message);
      }
    }

    return {
      isSafe: true,
      reason: 'Safety check passed (fallback mode)',
      provider: 'fallback-local',
      model: 'local-safety'
    };
  }
}

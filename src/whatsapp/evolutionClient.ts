import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export class EvolutionClient {
  private client: AxiosInstance;
  private instanceName: string;

  constructor() {
    this.instanceName = config.EVOLUTION_INSTANCE_NAME;
    this.client = axios.create({
      baseURL: config.EVOLUTION_API_URL,
      headers: {
        'apikey': config.EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
  }

  /**
   * Calculates realistic human typing delay based on message length and natural reading/writing speed.
   */
  private calculateHumanTypingDelay(text: string): number {
    const baseDelay = 1500; // 1.5s base pause before typing
    const typingSpeedMsPerChar = 35; // ~30-40ms per character (natural human typing speed)
    const jitter = Math.floor(Math.random() * 1200); // 0 to 1.2s random variance
    const calculated = baseDelay + (text.length * typingSpeedMsPerChar) + jitter;

    // Cap between 2 seconds and 7 seconds to keep responses prompt yet natural
    return Math.min(Math.max(calculated, 2000), 7000);
  }

  /**
   * Sets presence (composing / typing state) on WhatsApp to simulate human typing.
   */
  public async setPresence(remoteJid: string, presence: 'composing' | 'paused' | 'recording'): Promise<void> {
    try {
      await this.client.post(`/chat/sendPresence/${this.instanceName}`, {
        number: remoteJid,
        presence,
        delay: 2000
      });
    } catch (error) {
      console.warn(`Failed to set WhatsApp presence for ${remoteJid}:`, (error as Error).message);
    }
  }

  /**
   * Sends a text message with dynamic human typing indicator and behavioral delay.
   */
  public async sendTextMessage(remoteJid: string, text: string): Promise<boolean> {
    try {
      const typingDelay = this.calculateHumanTypingDelay(text);
      console.log(`[Humanized Behavior] Simulating human typing for ${(typingDelay / 1000).toFixed(1)}s to ${remoteJid}...`);

      // 1. Show 'composing...' typing indicator on WhatsApp
      await this.setPresence(remoteJid, 'composing');

      // 2. Wait for natural human typing duration
      await new Promise((resolve) => setTimeout(resolve, typingDelay));

      // 3. Dispatch text message via Evolution API REST endpoint
      const response = await this.client.post(`/message/sendText/${this.instanceName}`, {
        number: remoteJid,
        options: {
          delay: 500,
          presence: 'composing'
        },
        textMessage: {
          text
        }
      });

      return response.status === 200 || response.status === 201;
    } catch (error) {
      console.error(`Error sending WhatsApp message to ${remoteJid}:`, (error as Error).message);
      return false;
    }
  }
}

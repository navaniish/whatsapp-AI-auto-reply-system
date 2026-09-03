export interface SituationAnalysis {
  languageStyle: 'TELUGU_ROMAN' | 'HINGLISH' | 'ENGLISH_CASUAL' | 'ENGLISH_FORMAL' | 'OTHER';
  relationshipTier: 'BEST_FRIEND' | 'CLOSE_FAMILY' | 'BUSINESS_CLIENT' | 'NEW_CONTACT';
  relationshipTone: 'CASUAL_FRIEND' | 'CUSTOMER_INQUIRY' | 'FORMAL_BUSINESS';
  detectedMood: 'PLAYFUL_FRIENDLY' | 'NEUTRAL_INFORMAL' | 'URGENT_SERIOUS' | 'CURIOUS';
  situationalTopic: string;
  humanResponseStrategy: string;
  hasMedia: boolean;
  hasLink: boolean;
  isQuestion: boolean;
}

export class SituationalAnalyzer {
  /**
   * Performs deep analysis on incoming WhatsApp messages to detect dialect, relationship tier, mood, intent, links, questions, and media types.
   */
  public static analyze(text: string, pushName: string): SituationAnalysis {
    const lower = text.trim().toLowerCase();
    const hasMedia = lower.includes('[user sent a photo/image]') || lower.includes('[photo]') || lower.includes('[media]');
    const hasLink = /https?:\/\/[^\s]+/i.test(text);
    const isQuestion = text.includes('?') || /\b(kya|kaise|kab|kahan|kyun|em|enti|ela|eppudu|ekada|why|what|when|where|how|who|can|will|would|could|is|are)\b/i.test(lower);

    // 1. Language & Dialect Detection
    let languageStyle: SituationAnalysis['languageStyle'] = 'ENGLISH_CASUAL';
    if (/\b(em|chasuthna|chasthav|unnav|ela|sangathi|cheppu|nenu|vunnara|kadhra|bhaiya|ra|bro|raa|bava|macha|mamoi|thinnava|enti|kadhava)\b/i.test(lower)) {
      languageStyle = 'TELUGU_ROMAN';
    } else if (/\b(kya|kar|rahe|ho|kaise|bhai|hai|nahin|accha|samjha|karo|batao|kaisa|suno|yara|yar|milenge|kal|parso)\b/i.test(lower)) {
      languageStyle = 'HINGLISH';
    } else if (/\b(dear|sir|madam|kindly|inquire|regarding|business|services|pricing|cost|schedule|proposal|invoice)\b/i.test(lower)) {
      languageStyle = 'ENGLISH_FORMAL';
    }

    // 2. Relationship Tier & Tone Classification
    let relationshipTier: SituationAnalysis['relationshipTier'] = 'BEST_FRIEND';
    let relationshipTone: SituationAnalysis['relationshipTone'] = 'CASUAL_FRIEND';

    if (/\b(sir|madam|invoice|order|quote|price|client|customer|service|payment)\b/i.test(lower)) {
      relationshipTier = 'BUSINESS_CLIENT';
      relationshipTone = 'FORMAL_BUSINESS';
    } else if (/\b(mom|dad|amma|nanna|bro|sis|annayya|akka|bava|pinni|babai)\b/i.test(lower)) {
      relationshipTier = 'CLOSE_FAMILY';
      relationshipTone = 'CASUAL_FRIEND';
    } else if (/\b(ra|raa|macha|bro|bhai|bava|boss|dude|man)\b/i.test(lower)) {
      relationshipTier = 'BEST_FRIEND';
      relationshipTone = 'CASUAL_FRIEND';
    } else if (languageStyle === 'ENGLISH_FORMAL') {
      relationshipTier = 'NEW_CONTACT';
      relationshipTone = 'CUSTOMER_INQUIRY';
    }

    // 3. Mood Detection
    let detectedMood: SituationAnalysis['detectedMood'] = 'NEUTRAL_INFORMAL';
    if (/\b(urgent|help|asap|fast|issue|problem|broken|error|emergency)\b/i.test(lower)) {
      detectedMood = 'URGENT_SERIOUS';
    } else if (isQuestion) {
      detectedMood = 'CURIOUS';
    } else if (/\b(hi|hello|hey|em|hlo|bro|dude|fun|lol|haha|raa|bhai)\b/i.test(lower)) {
      detectedMood = 'PLAYFUL_FRIENDLY';
    }

    // 4. Deep Topic Analysis
    let situationalTopic = 'General Conversation';
    if (hasMedia) {
      situationalTopic = 'Photo / Media Shared';
    } else if (hasLink) {
      situationalTopic = 'URL Link Shared';
    } else if (/\b(em|chasuthna|kar rahe|doing|sup|what's up|hlo|hi|hello|cheppu)\b/i.test(lower)) {
      situationalTopic = 'Greeting & Chit-Chat';
    } else if (/\b(price|cost|rate|fee|charge)\b/i.test(lower)) {
      situationalTopic = 'Pricing & Rates Inquiry';
    } else if (/\b(hour|time|open|close|schedule|meet|milenge)\b/i.test(lower)) {
      situationalTopic = 'Meetup & Scheduling Inquiry';
    } else if (/\b(order|track|shipment|delivery|status)\b/i.test(lower)) {
      situationalTopic = 'Order Status Tracking';
    }

    // 5. Dynamic Response Strategy
    let humanResponseStrategy = '';
    if (hasMedia) {
      switch (languageStyle) {
        case 'TELUGU_ROMAN':
          humanResponseStrategy = `The user shared media/photo. Acknowledge it in Romanized Telugu like a close friend (e.g., "Photo chusanu ${pushName}! Super pic ra! 👍").`;
          break;
        case 'HINGLISH':
          humanResponseStrategy = `The user shared media/photo. Acknowledge it in casual Hinglish (e.g., "Photo mil gayi ${pushName}! Badhiya hai bhai 👍").`;
          break;
        default:
          humanResponseStrategy = `The user shared media/photo. Acknowledge it naturally in 1 short sentence as a real person.`;
          break;
      }
    } else if (hasLink) {
      humanResponseStrategy = `The user shared a link. Acknowledge receiving the link naturally and ask what it's about.`;
    } else {
      switch (languageStyle) {
        case 'TELUGU_ROMAN':
          humanResponseStrategy = `Respond in warm, natural Romanized Telugu like a close friend (e.g., "Emi ledhu ${pushName}, chill chesthunna! Cheppu raa enthi sangathi? 😊").`;
          break;
        case 'HINGLISH':
          humanResponseStrategy = `Respond in casual Hinglish like a close buddy (e.g., "Bas badhiya ${pushName}! Tum batao kya chal raha hai bhai?").`;
          break;
        case 'ENGLISH_FORMAL':
          humanResponseStrategy = `Respond in polite, helpful, professional 1-2 sentences as a customer representative.`;
          break;
        default:
          humanResponseStrategy = `Respond in warm, conversational 1-2 sentence English like a real person.`;
          break;
      }
    }

    return {
      languageStyle,
      relationshipTier,
      relationshipTone,
      detectedMood,
      situationalTopic,
      humanResponseStrategy,
      hasMedia,
      hasLink,
      isQuestion
    };
  }
}

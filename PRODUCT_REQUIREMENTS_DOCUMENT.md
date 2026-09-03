# Product Requirements Document (PRD): Universal WhatsApp Auto-Reply AI System

## 1. Product Overview
**Name**: Personal WhatsApp AI Contextual Reply Agent
**Description**: An autonomous, self-hosted AI agent that intercepts incoming WhatsApp messages and replies in real-time on behalf of the user. It is designed to emulate the exact conversational tone, dialect, and context of the user, while guaranteeing 100% message coverage across all contacts, unread messages, and media types.
**Status**: Active / Production

---

## 2. Core Objectives & Requirements

### 2.1. 100% Universal Contact Coverage (No Dropped Messages)
- **Requirement**: The system MUST reply to every incoming message, regardless of whether the contact is saved in the phonebook, a new unsaved number, an archived chat, or a linked device (`@lid`).
- **Implementation**: 
  - Dual Listener Registration: Register both `message` and `message_create` event listeners in `whatsapp-web.js`.
  - Deduplication: Maintain a rolling `Set` of the last 500 processed message IDs to prevent duplicate processing if both listeners fire.
  - Linked Device Resolution: Automatically resolve `@lid` JIDs to raw phone numbers (`@c.us`) via `client.getContactLidAndPhone` before dispatching replies.

### 2.2. Multi-Turn Context & Thread Continuity
- **Requirement**: The AI MUST NEVER behave like a stateless bot. It must read previous messages in the chat to understand exactly what was said before.
- **Implementation**:
  - Maintain a 15-turn sliding window memory per contact (`ConversationMemoryEngine`).
  - Hydrate memory dynamically via `chat.fetchMessages({ limit: 10 })` to ensure the AI knows its previous reply before generating the next one.
  - **Prompt Enforcement**: System prompts strictly enforce continuity ("If the previous reply asked a question, respond directly to the user's answer").

### 2.3. Universal Media Support
- **Requirement**: The system MUST gracefully handle non-text messages (e.g., photos, audio/voice notes, stickers) and generate contextual text responses.
- **Implementation**: Provide universal text fallbacks for all message types:
  - Voice Notes (`audio` / `ptt`): `[User sent a voice note / audio message]`
  - Images / Photos: `[User sent a photo/image]` (or include caption if available).
  - Stickers: `[User sent a sticker]`
  - Shared Locations: `[User shared their location]`
  - Documents: `[User sent a document/file]`
  - Contact Cards (`vcard`): `[User shared a contact card]`

### 2.4. Triple-Failsafe Dispatch Architecture
- **Requirement**: The system MUST guarantee reply delivery under all network and protocol conditions.
- **Implementation**:
  - **Failsafe 1**: `chat.sendMessage(text)` - Direct dispatch via the native WhatsApp Web chat object.
  - **Failsafe 2**: `msg.reply(text)` - Direct reply thread context chaining.
  - **Failsafe 3**: `client.sendMessage(formattedJid, text)` - API-level dispatch with strict JID formatting (stripping trailing characters and ensuring `@c.us` format).

### 2.5. Human Simulation (Anti-Bot Detection)
- **Requirement**: The AI must simulate human behavior to prevent WhatsApp from flagging the account as a bot and to provide a natural experience for contacts.
- **Implementation**:
  - **Typing Status (`HumanTypingSimulator`)**: Broadcast a real-time `composing...` WebSocket event to the contact's phone.
  - **Dynamic Delay**: Calculate typing delays based on text length (e.g., 50-80ms per character) plus cognitive read delays (1000-2000ms).
  - **Language Parsing (`SituationalAnalyzer`)**: Automatically adapt to Telugu Romanized, Hinglish, or English based on the incoming message.

### 2.6. Infinite Loop Suppression
- **Requirement**: The AI MUST NOT get trapped in infinite back-and-forth loops if the other contact is also an automated bot.
- **Implementation**:
  - **`BotLoopDetector`**: Track message frequency. If a contact sends >5 messages within 30 seconds, temporarily suppress auto-replies for that contact for 2 minutes.

---

## 3. System Architecture

1. **Ingress**: `whatsapp-web.js` (Puppeteer/Chromium Engine)
2. **Listener Hub**: `whatsappClient.ts` (Dual listener + deduplication)
3. **Queue**: `ContactQueueManager` (Sequential processing per contact to prevent race conditions)
4. **Context Engine**: `ConversationMemoryEngine` (15-turn hydration)
5. **AI Gateway**: `openai/gpt-oss-20b` (Tone parsing, dialect matching, content generation)
6. **Egress Dispatch**: Triple-Failsafe architecture (`sendReply`)

---

## 4. Success Metrics
- 0% dropped messages from unsaved numbers.
- 0% delivery failures due to `@lid` JID formatting errors.
- <3000ms latency between incoming message read and typing indicator broadcast.
- 100% uptime recovery on Puppeteer crash.

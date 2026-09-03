import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // WhatsApp Gateway
  EVOLUTION_API_URL: z.string().default('http://localhost:8080'),
  EVOLUTION_API_KEY: z.string().default('my_super_secret_evolution_key_123'),
  EVOLUTION_INSTANCE_NAME: z.string().default('personal_whatsapp'),
  
  // NVIDIA NIM Multi-Model Architecture
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  
  // 1. Classifier Model (openai/gpt-oss-20b)
  NVIDIA_CLASSIFIER_KEY: z.string().default('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'),
  NVIDIA_CLASSIFIER_MODEL: z.string().default('openai/gpt-oss-20b'),
  
  // 2. Generator Model (openai/gpt-oss-20b)
  NVIDIA_GENERATOR_KEY: z.string().default('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'),
  NVIDIA_GENERATOR_MODEL: z.string().default('openai/gpt-oss-20b'),
  
  // 3. Content Safety Guardrail Model (openai/gpt-oss-20b)
  NVIDIA_SAFETY_KEY: z.string().default('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'),
  NVIDIA_SAFETY_MODEL: z.string().default('openai/gpt-oss-20b'),
  
  // Data persistence
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/whatsapp_agent'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  
  // Human-In-The-Loop WhatsApp Owner Config
  OWNER_WHATSAPP_NUMBER: z.string().optional(),
  
  // Policy & Safety Thresholds
  AUTO_SEND_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.95),
  DRAFT_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.70),
  MAX_AUTO_REPLIES_PER_HOUR: z.coerce.number().default(10),
  SERVICE_WINDOW_HOURS: z.coerce.number().default(24),
});

export const config = envSchema.parse(process.env);

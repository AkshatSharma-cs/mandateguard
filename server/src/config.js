// server/src/config.js
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_PATH: z.string().min(1).default('./mandateguard.db'),
  LLM_MODE: z.enum(['live', 'record', 'replay']).default('replay'),
  LLM_PROVIDER: z.enum(['gemini', 'anthropic']).default('gemini'),
  LLM_API_KEY: z.string().optional(),
  // Empty values in an existing .env file should not produce a malformed provider URL.
  LLM_MODEL: z.string().trim().default('gemini-3.8-flash').transform((value) => value || 'gemini-3.8-flash'),
  PAYPAL_CLIENT_ID: z.string().default(''),
  PAYPAL_CLIENT_SECRET: z.string().default(''),
  PAYPAL_BASE_URL: z.string().url().default('https://api-m.sandbox.paypal.com'),
  PAYPAL_BUSINESS_EMAIL: z.string().default(''),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  CHANNEL3_API_KEY: z.string().default(''),
  CHANNEL3_API_URL: z.string().url().default('https://api.trychannel3.com'),
  CHANNEL3_REGION: z.string().min(2).max(8).default('US'),
  INCLUDE_DEMO_LISTINGS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MAX_LLM_CALLS_PER_RUN: z.coerce.number().int().min(1).max(100).default(20),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join('.'));
  throw new Error(`Invalid environment configuration: ${[...new Set(missing)].join(', ')}`);
}
if (parsed.data.LLM_MODE !== 'replay' && !parsed.data.LLM_API_KEY?.trim()) {
  throw new Error('Invalid environment configuration: LLM_API_KEY is required when LLM_MODE is live or record');
}

export const config = Object.freeze({ ...parsed.data });
export default config;

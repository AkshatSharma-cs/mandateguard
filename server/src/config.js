// server/src/config.js
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_PATH: z.string().min(1).default('./mandateguard.db'),
  LLM_MODE: z.enum(['live', 'record', 'replay']).default('replay'),
  LLM_PROVIDER: z.enum(['gemini', 'anthropic']).default('gemini'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default(''),
  PAYPAL_CLIENT_ID: z.string().default(''),
  PAYPAL_CLIENT_SECRET: z.string().default(''),
  PAYPAL_BASE_URL: z.string().url().default('https://api-m.sandbox.paypal.com'),
  PAYPAL_BUSINESS_EMAIL: z.string().default(''),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
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

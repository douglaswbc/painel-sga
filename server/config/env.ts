import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const hex64Regex = /^[a-fA-F0-9]{64}$/;

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  APP_PUBLIC_URL: z.string().trim().url().optional(),
  DATABASE_PATH: z.string().trim().min(1).default('./data/sga.db'),
  UPLOAD_DIR: z.string().trim().min(1).default('./data/uploads'),

  JWT_SECRET: z.string().trim().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres.'),
  JWT_EXPIRES_IN: z.string().trim().min(1).default('7d'),

  ENCRYPTION_KEY: z.string().trim().regex(hex64Regex, 'ENCRYPTION_KEY deve ter 64 caracteres hexadecimais.').optional(),
  ZERNIO_ENCRYPTION_KEY: z.string().trim().regex(hex64Regex).optional(),
  META_ENCRYPTION_KEY: z.string().trim().regex(hex64Regex).optional(),
  RESEND_ENCRYPTION_KEY: z.string().trim().regex(hex64Regex).optional(),
  MP_ENCRYPTION_KEY: z.string().trim().regex(hex64Regex).optional(),

  ADMIN_EMAIL: z.string().trim().email().optional(),
  ADMIN_PASSWORD: z.string().min(6).optional(),
  ADMIN_NAME: z.string().trim().min(1).default('Administrador'),

  MP_WEBHOOK_URL: z.string().trim().url().optional(),
  ZERNIO_REDIRECT_BASE_URL: z.string().trim().url().optional(),
  SGA_APP_URL: z.string().trim().url().optional(),

  META_APP_ID: z.string().trim().optional(),
  META_APP_SECRET: z.string().trim().optional(),
  META_GRAPH_VERSION: z.string().trim().default('v23.0'),
  META_WEBHOOK_VERIFY_TOKEN: z.string().trim().optional(),

  ENABLE_CRON: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppEnv = {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  host: string;
  appPublicUrl: string;
  databasePath: string;
  uploadDir: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  encryptionKeys: {
    master: string;
    zernio: string;
    meta: string;
    resend: string;
    mp: string;
  };
  bootstrapAdmin: {
    email?: string;
    password?: string;
    name: string;
  };
  urls: {
    mpWebhook: string;
    metaWebhook: string;
    lockWebhook: string;
    zernioRedirectBase: string;
    sgaApp: string;
  };
  meta: {
    appId: string;
    appSecret: string;
    graphVersion: string;
    webhookVerifyToken: string;
  };
  enableCron: boolean;
};

let cachedEnv: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = rawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => ` - ${issue.path.join('.') || 'ENV'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente (.env) inválida:\n${details}`);
  }

  const data = parsed.data;
  const masterKey = data.ENCRYPTION_KEY ?? data.ZERNIO_ENCRYPTION_KEY ?? '';
  if (!hex64Regex.test(masterKey)) {
    throw new Error(
      'Configuração de ambiente (.env) inválida:\n - Defina ENCRYPTION_KEY (64 caracteres hexadecimais).',
    );
  }

  const appPublicUrl = (data.APP_PUBLIC_URL ?? `http://localhost:${data.PORT}`).replace(/\/+$/, '');

  cachedEnv = {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    host: data.HOST,
    appPublicUrl,
    databasePath: path.resolve(process.cwd(), data.DATABASE_PATH),
    uploadDir: path.resolve(process.cwd(), data.UPLOAD_DIR),
    jwtSecret: data.JWT_SECRET,
    jwtExpiresIn: data.JWT_EXPIRES_IN,
    encryptionKeys: {
      master: masterKey,
      zernio: data.ZERNIO_ENCRYPTION_KEY ?? masterKey,
      meta: data.META_ENCRYPTION_KEY ?? data.ZERNIO_ENCRYPTION_KEY ?? masterKey,
      resend: data.RESEND_ENCRYPTION_KEY ?? data.META_ENCRYPTION_KEY ?? data.ZERNIO_ENCRYPTION_KEY ?? masterKey,
      mp: data.MP_ENCRYPTION_KEY ?? masterKey,
    },
    bootstrapAdmin: {
      email: data.ADMIN_EMAIL,
      password: data.ADMIN_PASSWORD,
      name: data.ADMIN_NAME,
    },
    urls: {
      mpWebhook: (data.MP_WEBHOOK_URL ?? `${appPublicUrl}/api/webhooks/mercadopago`).replace(/\/+$/, ''),
      metaWebhook: `${appPublicUrl}/api/webhooks/meta`,
      lockWebhook: `${appPublicUrl}/api/webhooks/fechadura`,
      zernioRedirectBase: (data.ZERNIO_REDIRECT_BASE_URL ?? appPublicUrl).replace(/\/+$/, ''),
      sgaApp: (data.SGA_APP_URL ?? appPublicUrl).replace(/\/+$/, ''),
    },
    meta: {
      appId: data.META_APP_ID ?? '',
      appSecret: data.META_APP_SECRET ?? '',
      graphVersion: data.META_GRAPH_VERSION,
      webhookVerifyToken: data.META_WEBHOOK_VERIFY_TOKEN ?? '',
    },
    enableCron: data.ENABLE_CRON,
  };

  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}

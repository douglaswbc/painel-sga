import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { loadEnv } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'application/pdf'];
const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // 16 MB (WhatsApp media limit)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MEDIA_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = ALLOWED_MIME_PREFIXES.some((prefix) => file.mimetype.startsWith(prefix));
    if (!allowed) {
      cb(new Error('Tipo de arquivo não permitido. Envie imagem, vídeo, áudio ou PDF.'));
      return;
    }
    cb(null, true);
  },
});

function sanitizeFilename(originalName: string): string {
  const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
  const base = path
    .basename(originalName, path.extname(originalName))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60);
  return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${base || 'arquivo'}${ext}`;
}

export function resolveMediaDiskPath(userId: string, relativePath: string): string {
  const env = loadEnv();
  const baseDir = path.resolve(env.uploadDir, 'mensagens-midia');
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned.startsWith(`${userId}/`) || cleaned.includes('..')) {
    throw new Error('Caminho de mídia inválido.');
  }
  const target = path.resolve(baseDir, cleaned);
  if (!target.startsWith(path.resolve(baseDir, userId) + path.sep)) {
    throw new Error('Caminho de mídia fora do diretório permitido.');
  }
  return target;
}

router.post('/', requireAuth, upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      return;
    }

    const env = loadEnv();
    const userId = req.user!.id;
    const filename = sanitizeFilename(req.file.originalname);
    const relativePath = `${userId}/${filename}`;
    const userDir = path.resolve(env.uploadDir, 'mensagens-midia', userId);
    fs.mkdirSync(userDir, { recursive: true });

    const targetPath = path.join(userDir, filename);
    fs.writeFileSync(targetPath, req.file.buffer);

    res.status(201).json({
      path: relativePath,
      publicUrl: `${env.urls.sgaApp}/uploads/mensagens-midia/${relativePath}`,
      mimetype: req.file.mimetype,
      filename: req.file.originalname,
      size: req.file.size,
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/', requireAuth, (req, res, next) => {
  try {
    const filePath = typeof req.body?.path === 'string'
      ? req.body.path
      : typeof req.query?.path === 'string'
        ? req.query.path
        : '';

    if (!filePath) {
      res.status(400).json({ error: 'Informe o caminho do arquivo a remover.' });
      return;
    }

    const diskPath = resolveMediaDiskPath(req.user!.id, filePath);
    if (fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath);
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;

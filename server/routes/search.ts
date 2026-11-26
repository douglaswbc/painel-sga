import { Router } from 'express';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';
import { decryptSecret } from '../utils/crypto.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (term.length < 2) {
    res.json({ tenants: [], vehicles: [], assets: [] });
    return;
  }

  const db = getDb();
  const userId = req.user!.id;
  const pattern = `%${term.toLowerCase()}%`;

  const rawTenants = db
    .prepare(
      `SELECT id, nome_completo, whatsapp, cpf, cpf_enc
       FROM locatarios
       WHERE id_usuario = ? AND lower(nome_completo) LIKE ?
       LIMIT 5`,
    )
    .all(userId, pattern) as Array<{
    id: string;
    nome_completo: string;
    whatsapp: string;
    cpf: string | null;
    cpf_enc: string | null;
  }>;

  const tenants = rawTenants
    .map((row) => {
      let cpf = row.cpf ?? null;
      if (row.cpf_enc) {
        try {
          cpf = decryptSecret(row.cpf_enc, userId);
        } catch {
          // Mantém o valor em texto caso a cifra não possa ser lida
        }
      }
      return {
        id: row.id,
        nome_completo: row.nome_completo,
        whatsapp: row.whatsapp,
        cpf,
      };
    })
    .sort((a, b) => (a.nome_completo || '').localeCompare(b.nome_completo || '', 'pt-BR'));

  const rawVehicles = db
    .prepare(
      `SELECT id, placa, modelo, marca, tipo, categoria, ativo
       FROM veiculos
       WHERE id_usuario = ? AND (lower(placa) LIKE ? OR lower(modelo) LIKE ? OR lower(coalesce(categoria, '')) LIKE ?)
       LIMIT 5`,
    )
    .all(userId, pattern, pattern, pattern) as Array<{
    id: string;
    placa: string;
    modelo: string;
    marca: string | null;
    tipo: string | null;
    categoria: string | null;
    ativo: number;
  }>;

  const vehicles = rawVehicles
    .map((row) => ({
      ...row,
      identificador: row.placa,
      titulo: row.modelo,
      ativo: Number(row.ativo) === 1,
    }))
    .sort((a, b) => (a.modelo || '').localeCompare(b.modelo || '', 'pt-BR'));

  res.json({ tenants, vehicles, assets: vehicles });
});

export default router;

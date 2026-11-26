import { Router } from 'express';
import { getDb } from '../db/database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function brtPeriodBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const year = Number(map.year);
  const month = Number(map.month);
  const hoje = `${map.year}-${map.month}-${map.day}`;
  const inicioMes = `${map.year}-${map.month}-01`;

  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthStr = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const inicioMesUtc = new Date(`${inicioMes}T00:00:00-03:00`).getTime();
  const inicioProximoMesUtc = new Date(`${nextMonthStr}T00:00:00-03:00`).getTime();

  return { inicioMes, hoje, inicioMesUtc, inicioProximoMesUtc };
}

router.get('/nav-counts', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const atrasadasRow = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM cobrancas
       WHERE id_usuario = ? AND tipo = 'receita' AND status = 'atrasado'`,
    )
    .get(userId) as { total: number };

  const candidatosRow = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM candidatos
       WHERE id_usuario = ?
         AND lower(trim(coalesce(status, ''))) IN ('em análise', 'em analise', 'analise', 'aguardando processamento')`,
    )
    .get(userId) as { total: number };

  res.json({
    cobrancasAtrasadas: Number(atrasadasRow?.total ?? 0),
    candidatosPendentes: Number(candidatosRow?.total ?? 0),
  });
});

router.get('/summary', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const { inicioMes, hoje, inicioMesUtc, inicioProximoMesUtc } = brtPeriodBounds();

  const charges = db
    .prepare(
      `SELECT valor, status, tipo, data_vencimento, data_pagamento
       FROM cobrancas
       WHERE id_usuario = ?`,
    )
    .all(userId) as Array<{
    valor: number;
    status: string;
    tipo: string | null;
    data_vencimento: string;
    data_pagamento: string | null;
  }>;

  let receitaPagaMes = 0;
  let despesaPagaMes = 0;
  let receitaAReceber = 0;
  let totalAtrasado = 0;
  let cobrancasVencidasMes = 0;
  let cobrancasPagasMes = 0;

  for (const c of charges) {
    const tipo = c.tipo || 'receita';
    const valor = Number(c.valor || 0);

    if (c.status === 'pago') {
      const refIso = c.data_pagamento || `${c.data_vencimento}T12:00:00-03:00`;
      const refTs = new Date(refIso).getTime();
      if (Number.isFinite(refTs) && refTs >= inicioMesUtc && refTs < inicioProximoMesUtc) {
        if (tipo === 'receita') receitaPagaMes += valor;
        else if (tipo === 'despesa') despesaPagaMes += valor;
      }
    }

    if (tipo === 'receita') {
      if (c.status === 'pendente' || c.status === 'atrasado') {
        receitaAReceber += valor;
      }
      if (c.status === 'atrasado') {
        totalAtrasado += valor;
      }
      if (c.status !== 'cancelado' && c.data_vencimento >= inicioMes && c.data_vencimento <= hoje) {
        cobrancasVencidasMes += 1;
        if (c.status === 'pago') cobrancasPagasMes += 1;
      }
    }
  }

  const activeContractsRow = db
    .prepare(`SELECT COUNT(*) AS total FROM contratos WHERE id_usuario = ? AND status = 'ativo'`)
    .get(userId) as { total: number };

  const adimplenciaMes =
    cobrancasVencidasMes === 0
      ? null
      : Math.round((cobrancasPagasMes * 1000) / cobrancasVencidasMes) / 10;

  res.json({
    saldo_liquido_mes: receitaPagaMes - despesaPagaMes,
    receita_a_receber: receitaAReceber,
    total_atrasado: totalAtrasado,
    contratos_ativos: Number(activeContractsRow?.total ?? 0),
    adimplencia_mes: adimplenciaMes,
    cobrancas_vencidas_mes: cobrancasVencidasMes,
    cobrancas_pagas_mes: cobrancasPagasMes,
  });
});

router.get('/charges', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 8));
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'all';

  const countRows = db
    .prepare(
      `SELECT status, COUNT(*) AS total
       FROM cobrancas
       WHERE id_usuario = ? AND tipo = 'receita' AND status IN ('atrasado', 'pendente', 'pago')
       GROUP BY status`,
    )
    .all(userId) as Array<{ status: string; total: number }>;

  const statusCounts: Record<string, number> = { atrasado: 0, pendente: 0, pago: 0 };
  for (const r of countRows) {
    statusCounts[r.status] = Number(r.total || 0);
  }

  const statusWhere =
    statusFilter === 'all'
      ? `c.status IN ('atrasado', 'pendente')`
      : `c.status = ?`;

  const queryParams: Array<string | number> =
    statusFilter === 'all' ? [userId] : [userId, statusFilter];

  const offset = (page - 1) * pageSize;

  const rows = db
    .prepare(
      `SELECT
        c.id, c.id_locatario, c.id_contrato, c.valor, c.status, c.tipo, c.categoria,
        c.data_vencimento, c.payment_link, c.mercado_pago_id, c.tentativas_envio,
        c.created_at, c.pix_expires_at, c.pix_expired_at,
        lc.nome_completo AS lc_nome, lc.whatsapp AS lc_whatsapp,
        cl.nome_completo AS cl_nome, v.placa AS v_placa
       FROM cobrancas c
       LEFT JOIN locatarios lc ON lc.id = c.id_locatario AND lc.id_usuario = c.id_usuario
       LEFT JOIN contratos k ON k.id = c.id_contrato AND k.id_usuario = c.id_usuario
       LEFT JOIN locatarios cl ON cl.id = k.id_locatario AND cl.id_usuario = c.id_usuario
       LEFT JOIN veiculos v ON v.id = k.id_veiculo AND v.id_usuario = c.id_usuario
       WHERE c.id_usuario = ? AND c.tipo = 'receita' AND ${statusWhere}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...queryParams, pageSize, offset) as Array<Record<string, unknown>>;

  const items = rows.map((row) => ({
    id: String(row.id),
    id_locatario: row.id_locatario ? String(row.id_locatario) : null,
    valor: Number(row.valor),
    status: String(row.status),
    tipo: String(row.tipo || 'receita'),
    categoria: row.categoria ? String(row.categoria) : null,
    data_vencimento: String(row.data_vencimento),
    payment_link: row.payment_link ? String(row.payment_link) : null,
    mercado_pago_id: row.mercado_pago_id ? String(row.mercado_pago_id) : null,
    tentativas_envio: Number(row.tentativas_envio ?? 0),
    created_at: String(row.created_at),
    pix_expires_at: row.pix_expires_at ? String(row.pix_expires_at) : null,
    pix_expired_at: row.pix_expired_at ? String(row.pix_expired_at) : null,
    locatario_cobranca: row.lc_nome
      ? { nome_completo: String(row.lc_nome), whatsapp: String(row.lc_whatsapp ?? '') }
      : null,
    contratos: row.id_contrato
      ? {
          id: String(row.id_contrato),
          locatarios: row.cl_nome ? { nome_completo: String(row.cl_nome) } : null,
          veiculos: row.v_placa ? { placa: String(row.v_placa) } : null,
        }
      : null,
  }));

  const total =
    statusFilter === 'all'
      ? statusCounts.atrasado + statusCounts.pendente
      : (statusCounts[statusFilter] ?? 0);

  res.json({ items, total, statusCounts });
});

router.get('/operational-stats', (req, res) => {
  const db = getDb();
  const userId = req.user!.id;

  const vehicles = db
    .prepare('SELECT id, ativo FROM veiculos WHERE id_usuario = ?')
    .all(userId) as Array<{ id: string; ativo: number }>;

  const activeVehicleContracts = db
    .prepare(`SELECT DISTINCT id_veiculo FROM contratos WHERE id_usuario = ? AND status = 'ativo'`)
    .all(userId) as Array<{ id_veiculo: string }>;
  const rentedVehicleIds = new Set(activeVehicleContracts.map((c) => c.id_veiculo));

  const total = vehicles.length;
  const alugados = vehicles.filter((v) => Number(v.ativo) === 1 && rentedVehicleIds.has(v.id)).length;
  const disponiveis = vehicles.filter((v) => Number(v.ativo) === 1 && !rentedVehicleIds.has(v.id)).length;
  const inativos = vehicles.filter((v) => Number(v.ativo) !== 1).length;
  const ocupacao = total > 0 ? Math.round((alugados / total) * 100) : 0;

  const candidates = db
    .prepare('SELECT status FROM candidatos WHERE id_usuario = ?')
    .all(userId) as Array<{ status: string | null }>;

  let emAnalise = 0;
  let preAprovados = 0;
  for (const cand of candidates) {
    const norm = String(cand.status || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (norm === 'em analise' || norm === 'analise' || norm === 'aguardando processamento') {
      emAnalise += 1;
    } else if (norm === 'pre-aprovado' || norm === 'pre_aprovado' || norm === 'aguardando reserva' || norm === 'aguardando_reserva') {
      preAprovados += 1;
    }
  }

  res.json({
    fleetStats: { total, alugados, disponiveis, inativos, ocupacao, loading: false },
    candidateStats: { emAnalise, preAprovados, total: candidates.length, loading: false },
  });
});

export default router;

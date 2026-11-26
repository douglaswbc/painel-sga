export const SEGMENT_IDS = [
  'geral',
  'veiculos',
  'imoveis',
  'equipamentos',
  'servicos',
  'personalizado',
] as const;

export type SegmentId = (typeof SEGMENT_IDS)[number];

export type SegmentCustomConfig = {
  customerSingular?: string;
  customerPlural?: string;
  itemSingular?: string;
  itemPlural?: string;
  itemCodeLabel?: string;
  itemNameLabel?: string;
  usesItems?: boolean;
};

export function normalizeSegmentId(value: unknown): SegmentId {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase() as SegmentId;
    if ((SEGMENT_IDS as readonly string[]).includes(normalized)) {
      return normalized;
    }
  }
  return 'geral';
}

function sanitizeLabel(value: unknown, maxLen = 40): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

export function normalizeSegmentConfig(raw: unknown): SegmentCustomConfig | null {
  let source = raw;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) return null;
    try {
      source = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  const record = source as Record<string, unknown>;
  const clean: SegmentCustomConfig = {};

  const customerSingular = sanitizeLabel(record.customerSingular);
  const customerPlural = sanitizeLabel(record.customerPlural);
  const itemSingular = sanitizeLabel(record.itemSingular);
  const itemPlural = sanitizeLabel(record.itemPlural);
  const itemCodeLabel = sanitizeLabel(record.itemCodeLabel);
  const itemNameLabel = sanitizeLabel(record.itemNameLabel);

  if (customerSingular) clean.customerSingular = customerSingular;
  if (customerPlural) clean.customerPlural = customerPlural;
  if (itemSingular) clean.itemSingular = itemSingular;
  if (itemPlural) clean.itemPlural = itemPlural;
  if (itemCodeLabel) clean.itemCodeLabel = itemCodeLabel;
  if (itemNameLabel) clean.itemNameLabel = itemNameLabel;
  if (typeof record.usesItems === 'boolean') clean.usesItems = record.usesItems;

  return Object.keys(clean).length > 0 ? clean : null;
}

export function serializeSegmentConfig(raw: unknown): string | null {
  const clean = normalizeSegmentConfig(raw);
  return clean ? JSON.stringify(clean) : null;
}

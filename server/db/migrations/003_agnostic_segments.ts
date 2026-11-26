import type { DatabaseSync } from 'node:sqlite';

type TableColumn = { name: string; notnull: number };

function addMissingColumns(
  db: DatabaseSync,
  table: string,
  columns: ReadonlyArray<{ name: string; def: string }>,
): void {
  const existing = db.prepare(`PRAGMA table_info('${table}')`).all() as TableColumn[];
  const names = new Set(existing.map((c) => c.name));
  for (const col of columns) {
    if (!names.has(col.name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.def}`);
    }
  }
}

export function applyAgnosticSegmentsMigration(db: DatabaseSync): void {
  addMissingColumns(db, 'usuarios', [
    { name: 'segmento', def: "TEXT NOT NULL DEFAULT 'geral'" },
    { name: 'segmento_config_json', def: 'TEXT' },
  ]);

  addMissingColumns(db, 'veiculos', [
    { name: 'tipo', def: "TEXT NOT NULL DEFAULT 'item'" },
    { name: 'categoria', def: 'TEXT' },
    { name: 'descricao', def: 'TEXT' },
    { name: 'atributos_json', def: 'TEXT' },
  ]);

  addMissingColumns(db, 'candidatos', [
    { name: 'respostas_extras_json', def: 'TEXT' },
  ]);

  // Torna contratos.id_veiculo opcional (NULL) para suportar contratos sem item físico (serviços/planos).
  const contractCols = db.prepare("PRAGMA table_info('contratos')").all() as TableColumn[];
  const vehicleCol = contractCols.find((col) => col.name === 'id_veiculo');
  if (vehicleCol && Number(vehicleCol.notnull) === 1) {
    db.exec(`
      CREATE TABLE contratos_new (
        id TEXT PRIMARY KEY,
        id_locatario TEXT NOT NULL,
        id_veiculo TEXT,
        id_usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        valor REAL NOT NULL,
        recorrencia TEXT NOT NULL,
        data_inicio TEXT NOT NULL,
        proxima_cobranca TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ativo',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        ocorrencias_realizadas INTEGER DEFAULT 0,
        FOREIGN KEY (id_locatario, id_usuario) REFERENCES locatarios (id, id_usuario),
        FOREIGN KEY (id_veiculo, id_usuario) REFERENCES veiculos (id, id_usuario)
      );

      INSERT INTO contratos_new (
        id, id_locatario, id_veiculo, id_usuario, valor, recorrencia,
        data_inicio, proxima_cobranca, status, created_at, ocorrencias_realizadas
      )
      SELECT
        id, id_locatario, id_veiculo, id_usuario, valor, recorrencia,
        data_inicio, proxima_cobranca, status, created_at, ocorrencias_realizadas
      FROM contratos;

      DROP TABLE contratos;
      ALTER TABLE contratos_new RENAME TO contratos;

      CREATE UNIQUE INDEX IF NOT EXISTS contratos_id_usuario_uidx
        ON contratos (id, id_usuario);
      CREATE INDEX IF NOT EXISTS idx_contratos_usuario ON contratos(id_usuario);
      CREATE INDEX IF NOT EXISTS idx_contratos_locatario_usuario ON contratos (id_locatario, id_usuario);
      CREATE INDEX IF NOT EXISTS idx_contratos_veiculo_usuario ON contratos (id_veiculo, id_usuario);
    `);
  }
}

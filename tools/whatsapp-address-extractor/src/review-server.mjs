import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

export function startReviewServer({ baseDir, port = 4040 }) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/', (_req, res) => {
    res.type('html').send(`
    <html><body>
    <h2>Modo revisión</h2>
    <p>Abrí <code>/cases?date=YYYY-MM-DD</code> para listar pendientes.</p>
    </body></html>
    `);
  });

  app.get('/cases', (req, res) => {
    const date = String(req.query.date || '').trim();
    if (!date) return res.status(400).json({ error: 'date requerido' });

    const jsonPath = resolveReportPath(baseDir, date);
    if (!jsonPath) return res.status(404).json({ error: 'no existe resultado.json para la fecha' });

    const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const pending = rows.filter((r) => r.estado === 'REVISAR');
    res.json({ total: pending.length, pending, source: jsonPath });
  });

  app.post('/cases/update', (req, res) => {
    const { date, archivo, calle, altura } = req.body;
    const jsonPath = resolveReportPath(baseDir, String(date || '').trim());
    if (!jsonPath) return res.status(404).json({ error: 'reporte no encontrado para fecha' });

    const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const row = rows.find((r) => r.archivo === archivo);
    if (!row) return res.status(404).json({ error: 'archivo no encontrado' });

    row.calle = calle;
    row.altura = altura;
    row.direccion_detectada = `${calle || ''} ${altura || ''}`.trim();
    row.estado = 'OK';
    row.motivo = 'corregido manualmente';
    row.confianza = 1;

    fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
    res.json({ ok: true, row, jsonPath });
  });

  app.listen(port, () => {
    console.log(`Review server en http://localhost:${port}`);
    console.log(`Base reportes: ${baseDir}`);
  });
}

function resolveReportPath(baseDir, date) {
  const candidates = [
    path.join(baseDir, date, 'resultado.json'),
    path.join(baseDir, date, 'reports', 'resultado.json'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  startReviewServer({
    baseDir: process.env.WA_OUTPUT_DIR || path.resolve('output'),
    port: Number(process.env.REVIEW_PORT || 4040),
  });
}

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const app = express();
app.use(express.json({ limit: '5mb' }));

const base = path.resolve('tools/whatsapp-address-extractor/output');

app.get('/', (_req, res) => {
  res.type('html').send(`
  <html><body>
  <h2>Modo revisión</h2>
  <p>Abrí /cases?date=YYYY-MM-DD para listar pendientes.</p>
  </body></html>
  `);
});

app.get('/cases', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date requerido' });

  const jsonPath = path.join(base, String(date), 'resultado.json');
  if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: 'no existe resultado.json' });

  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const pending = rows.filter((r) => r.estado === 'REVISAR');
  res.json({ total: pending.length, pending });
});

app.post('/cases/update', (req, res) => {
  const { date, archivo, calle, altura } = req.body;
  const jsonPath = path.join(base, String(date), 'resultado.json');
  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const row = rows.find((r) => r.archivo === archivo);
  if (!row) return res.status(404).json({ error: 'archivo no encontrado' });

  row.calle = calle;
  row.altura = altura;
  row.direccion_detectada = `${calle} ${altura}`.trim();
  row.estado = 'OK';
  row.motivo = 'corregido manualmente';
  row.confianza = 1;

  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
  res.json({ ok: true, row });
});

const port = Number(process.env.REVIEW_PORT || 4040);
app.listen(port, () => {
  console.log(`Review server en http://localhost:${port}`);
});

import fs from 'node:fs';
import path from 'node:path';

export function writeReports({ outputDir, rows }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const reportsDir = path.join(outputDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const jsonPath = path.join(outputDir, 'resultado.json');
  const csvPath = path.join(outputDir, 'resultado.csv');
  const jsonPathReports = path.join(reportsDir, 'resultado.json');
  const csvPathReports = path.join(reportsDir, 'resultado.csv');

  const jsonBody = JSON.stringify(rows, null, 2);
  const csvBody = toCsv(rows);

  fs.writeFileSync(jsonPath, jsonBody);
  fs.writeFileSync(csvPath, csvBody);
  fs.writeFileSync(jsonPathReports, jsonBody);
  fs.writeFileSync(csvPathReports, csvBody);

  return { jsonPath, csvPath, jsonPathReports, csvPathReports };
}

function toCsv(rows) {
  const columns = [
    'fecha',
    'hora',
    'archivo',
    'direccion_detectada',
    'calle',
    'altura',
    'fuente',
    'confianza',
    'mensaje_relacionado',
    'estado',
    'motivo',
  ];

  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

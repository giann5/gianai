# WhatsApp Address Extractor (local)

Herramienta local en Node.js para recorrer mensajes de WhatsApp Web por fecha, detectar fotos, inferir dirección+altura con un sistema de scoring conservador y separar casos dudosos en `REVISAR`.

> Principio rector: **si hay duda, no inventar**.

## A) Arquitectura recomendada

Arquitectura modular en 4 capas:

1. **Ingesta (WhatsApp Web)**
   - `whatsapp-scraper.mjs`: abre WhatsApp Web con Playwright (perfil persistente), recorre el chat y extrae una línea temporal de mensajes.
   - Soporta fixture JSON para pruebas sin tocar el chat real.

2. **Inteligencia de asociación**
   - `address-parser.mjs`: parser por regex + normalización de abreviaciones.
   - `resolver.mjs`: combina evidencias (caption, mensajes cercanos, OCR, visión) y detecta conflictos.
   - `scoring.mjs`: ponderaciones y umbrales de estado `OK/REVISAR`.

3. **Procesamiento de imagen**
   - `ocr.mjs`: OCR local opcional con Tesseract.
   - `vision-provider.mjs`: módulo opcional de visión por API (aislado y con flag).

4. **Persistencia y revisión**
   - `downloader.mjs`: nombres de archivo y carpetas (`OK` / `REVISAR`).
   - `reporter.mjs`: salida JSON y CSV.
   - `review-server.mjs`: endpoint simple para revisar/corregir casos pendientes.

## B) Tecnologías recomendadas

- **Node.js 20+**
- **Playwright** (opcional, para modo real)
- **Tesseract.js** (opcional, OCR local)
- **OpenAI vision API** (opcional y bajo autorización)
- **Express** para modo revisión
- **CSV Stringify** para reportes

## C) Estructura de carpetas

```text
tools/whatsapp-address-extractor/
  src/
    address-parser.mjs
    cli.mjs
    downloader.mjs
    logger.mjs
    ocr.mjs
    pipeline.mjs
    reporter.mjs
    resolver.mjs
    review-server.mjs
    scoring.mjs
    types.mjs
    vision-provider.mjs
    whatsapp-scraper.mjs
  examples/
    sample-day.json
  output/
  package.json
  README.md
```

## D) Algoritmo para recorrer WhatsApp Web

1. Abrir contexto persistente Playwright (`.pw-profile`) para reutilizar sesión.
2. Navegar a `https://web.whatsapp.com`.
3. Esperar login/manual chat selection.
4. Identificar contenedor principal de mensajes.
5. Scroll progresivo hacia arriba hasta cubrir el día objetivo o tope de seguridad.
6. Extraer nodos mensaje con metadatos robustos (`data-id`, `aria-label`, texto, presencia de `img`).
7. Construir timeline ordenada (id, timestamp, tipo, dirección, texto/caption).
8. Filtrar por fecha objetivo.

> Nota: en WhatsApp Web real conviene mantener selectores por semántica (`role`, `aria-label`, `data-id`) y tener tests de regresión de extractor cada vez que cambia el DOM.

## E) Algoritmo foto ↔ dirección

Para cada foto:

1. **Candidato caption** (prioridad alta).
2. **Contexto hacia atrás** (1..3 mensajes).
3. **Contexto hacia adelante** (1..3 mensajes).
4. **OCR local** (si habilitado).
5. **Visión API** (solo si OCR no alcanza confianza mínima o no detecta dirección).
6. Combinar candidatos y ordenar por score.
7. Si top-1 y top-2 tienen direcciones distintas con score parecido => `REVISAR` por conflicto.
8. Si score final < umbral => `REVISAR`.

## F) Sistema de scoring

Pesos base en `scoring.mjs`:

- Caption foto: `0.92`
- Mensaje anterior inmediato: `0.90`
- Mensaje posterior inmediato: `0.82`
- OCR: `0.70`
- Vision API: `0.80`
- Penalización por conflicto: `-0.35`
- Penalización por ambigüedad: `-0.20`

Regla estado:

- `>= 0.85` => `OK`
- `0.70 - 0.84` => `OK` (media-alta)
- `0.50 - 0.69` => `REVISAR`
- `< 0.50` => `REVISAR`

## G) Esquema salida JSON/CSV

Campos:

- `fecha`
- `hora`
- `archivo`
- `direccion_detectada`
- `calle`
- `altura`
- `fuente`
- `confianza`
- `mensaje_relacionado`
- `estado` (`OK | REVISAR | ERROR`)
- `motivo`

## H) Código base funcional

Incluido en `src/`:

- CLI con modos `dry-run` y `download`
- Pipeline end-to-end
- Parser de dirección
- Score conservador
- Reportes JSON/CSV
- Servidor de revisión básico

## I) Instalación y uso

```bash
cd tools/whatsapp-address-extractor
npm install
```

### Modo simulación segura

```bash
npm run dry-run
```

### Modo real (solo lectura/clasificación)

```bash
npm run download
```

### OCR local

```bash
ENABLE_OCR=1 npm run download
```

### Visión API opcional

```bash
export OPENAI_API_KEY="..."
ENABLE_OCR=1 ENABLE_VISION=1 npm run download
```

### Modo revisión

```bash
npm run review
# luego abrir http://localhost:4040/cases?date=2026-04-25
```

## J) Modo prueba/simulación antes del chat real

1. Ejecutar `npm run simulate`.
2. Verificar `output/<fecha>/resultado.json`.
3. Confirmar que casos ambiguos vayan a `REVISAR`.
4. Ajustar pesos en `scoring.mjs` antes de usar chat real.

## K) Manejo de errores y logs

- Logger estructurado JSON en `output/logs/run-*.log`.
- Reintento sugerido para descarga/OCR/API en próxima iteración.
- Falla de OCR o Vision no rompe pipeline: registra warning y sigue.
- Error fatal de scraper se registra con stack.

## L) Mejoras futuras

1. Detección robusta de timezone y parsing real de hora WhatsApp.
2. Deduplicación por hash perceptual (pHash).
3. Reintentos exponenciales por descarga fallida.
4. UI web de revisión con miniaturas reales y edición masiva.
5. NER especializado para direcciones argentinas (diccionario de calles + barrios).
6. Suite de tests con snapshots de DOM de WhatsApp Web.
7. Modo "no enviar imagen a API" por política estricta con allowlist manual por foto.

## Seguridad/privacidad

- Todo corre local.
- No envía mensajes.
- No borra ni modifica chat.
- Vision API solo si `ENABLE_VISION=1` + `OPENAI_API_KEY`.
- Recomendado: ejecutar primero en `dry-run`.

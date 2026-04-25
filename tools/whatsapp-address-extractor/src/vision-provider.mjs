import OpenAI from 'openai';

export async function detectAddressWithVision({ imagePath, enabled, apiKey, logger }) {
  if (!enabled) return { hasAddress: false, confidence: 0, source: 'vision', note: 'vision deshabilitado' };
  if (!apiKey) return { hasAddress: false, confidence: 0, source: 'vision', note: 'OPENAI_API_KEY faltante' };

  const client = new OpenAI({ apiKey });

  const prompt = `Extraé dirección postal de esta imagen (Argentina), devolvé SOLO JSON con: hay_direccion(boolean), calle, altura, direccion_normalizada, confianza(0-1), observaciones.`;

  try {
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `file://${imagePath}` },
          ],
        },
      ],
      text: { format: { type: 'json_object' } },
    });

    const raw = response.output_text;
    const data = JSON.parse(raw);
    return {
      hasAddress: Boolean(data.hay_direccion),
      street: data.calle || '',
      number: data.altura || '',
      normalizedAddress: data.direccion_normalizada || '',
      confidence: Number(data.confianza || 0),
      source: 'vision',
      note: data.observaciones || 'vision api',
    };
  } catch (error) {
    logger.warn('Vision API fallo', { message: error.message });
    return { hasAddress: false, confidence: 0, source: 'vision', note: 'fallo vision api' };
  }
}

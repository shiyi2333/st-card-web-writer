export function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl).replace(/\/+$/, '');
}

function apiUrl(config, route) {
  return `${normalizeBaseUrl(config.baseUrl)}${route}`;
}

export async function fetchModels(config) {
  const response = await fetch(apiUrl(config, '/models'), {
    headers: {
      Authorization: `Bearer ${config.apiKey}`
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`获取模型失败: ${response.status} ${detail}`);
  }
  const payload = await response.json();
  return payload.data || [];
}

export async function chatStream({ config, messages, onToken }) {
  const response = await fetch(apiUrl(config, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: Number(config.temperature ?? 0.8),
      stream: true
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型请求失败: ${response.status} ${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content || '';
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {
        // Ignore partial provider metadata lines.
      }
    }
  }

  return fullText;
}

export async function chatJson({ config, messages, temperature = 0.1 }) {
  const response = await fetch(apiUrl(config, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型请求失败: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || '';
  const jsonText = content.match(/```json\s*([\s\S]*?)```/i)?.[1]
    || content.match(/\{[\s\S]*\}/)?.[0]
    || content;
  return JSON.parse(jsonText);
}

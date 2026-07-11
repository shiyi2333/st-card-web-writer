export function normalizeBaseUrl(baseUrl = '') {
  return String(baseUrl).replace(/\/+$/, '');
}

function apiUrl(config, route) {
  return `${normalizeBaseUrl(config.baseUrl)}${route}`;
}

function provider(config = {}) {
  return config.provider === 'anthropic' ? 'anthropic' : 'openai';
}

function anthropicHeaders(config) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': config.anthropicVersion || '2023-06-01'
  };
}

function normalizeAnthropicMessages(messages = []) {
  const system = [];
  const chat = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'system';
    if (role === 'system') {
      if (message.content) system.push(message.content);
      continue;
    }
    const content = String(message.content || '');
    const last = chat.at(-1);
    if (last?.role === role) {
      last.content += `\n\n${content}`;
    } else {
      chat.push({ role, content });
    }
  }
  if (!chat.length) chat.push({ role: 'user', content: '继续。' });
  return {
    system: system.join('\n\n'),
    messages: chat
  };
}

export async function fetchModels(config) {
  if (provider(config) === 'anthropic') {
    const response = await fetch(apiUrl(config, '/models'), {
      headers: anthropicHeaders(config)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`获取模型失败: ${response.status} ${detail}`);
    }
    const payload = await response.json();
    return payload.data || [];
  }

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
  if (provider(config) === 'anthropic') {
    return chatStreamAnthropic({ config, messages, onToken });
  }

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
  if (provider(config) === 'anthropic') {
    const text = await chatTextAnthropic({ config, messages, temperature });
    const jsonText = text.match(/```json\s*([\s\S]*?)```/i)?.[1]
      || text.match(/\{[\s\S]*\}/)?.[0]
      || text;
    return JSON.parse(jsonText);
  }

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

export async function chatText({ config, messages, temperature = 0.8 }) {
  if (provider(config) === 'anthropic') {
    return chatTextAnthropic({ config, messages, temperature });
  }

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
    throw new Error(`妯″瀷璇锋眰澶辫触: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || '';
}

async function chatStreamAnthropic({ config, messages, onToken }) {
  const normalized = normalizeAnthropicMessages(messages);
  const response = await fetch(apiUrl(config, '/messages'), {
    method: 'POST',
    headers: anthropicHeaders(config),
    body: JSON.stringify({
      model: config.model,
      system: normalized.system || undefined,
      messages: normalized.messages,
      temperature: Number(config.temperature ?? 0.8),
      max_tokens: Number(config.maxTokens || 4096),
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
        const token = parsed.type === 'content_block_delta' ? parsed.delta?.text || '' : '';
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

async function chatTextAnthropic({ config, messages, temperature = 0.1 }) {
  const normalized = normalizeAnthropicMessages(messages);
  const response = await fetch(apiUrl(config, '/messages'), {
    method: 'POST',
    headers: anthropicHeaders(config),
    body: JSON.stringify({
      model: config.model,
      system: normalized.system || undefined,
      messages: normalized.messages,
      temperature,
      max_tokens: Number(config.maxTokens || 2048),
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`模型请求失败: ${response.status} ${detail}`);
  }

  const payload = await response.json();
  return (payload.content || []).map((item) => item.type === 'text' ? item.text : '').join('');
}

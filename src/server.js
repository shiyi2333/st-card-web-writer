import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JsonStore, id, maskKey, nowIso } from './store.js';
import { defaultStore, buildMessages } from './prompts.js';
import { chatStream, fetchModels } from './ai.js';
import { latestAssistantMarkdown, makeCardJson, previewFromMarkdown } from './card.js';
import { writeCardPng } from './png.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const exportDir = path.resolve(process.env.EXPORT_DIR || path.join(rootDir, 'exports'));
const store = new JsonStore(process.env.STORE_PATH || path.join(rootDir, 'data', 'store.json'));

await store.init(defaultStore());
await fs.mkdir(exportDir, { recursive: true });

const app = express();
const port = Number(process.env.PORT || 5678);
const host = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '30mb' }));
app.use(express.static(publicDir));
app.use('/exports', express.static(exportDir));

function safeModel(model) {
  return { ...model, apiKey: maskKey(model.apiKey) };
}

function activeModel(data = store.data) {
  return data.models.find((model) => model.id === data.activeModelId) || null;
}

function activePrompt(data = store.data) {
  return data.prompts.find((prompt) => prompt.id === data.activePromptId) || null;
}

function findConversation(conversationId, data = store.data) {
  return data.conversations.find((conversation) => conversation.id === conversationId) || null;
}

function publicConversation(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length
  };
}

function requireBody(req, names) {
  for (const name of names) {
    if (req.body[name] === undefined || req.body[name] === '') {
      const error = new Error(`缺少字段: ${name}`);
      error.status = 400;
      throw error;
    }
  }
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    port,
    activeModel: activeModel() ? safeModel(activeModel()) : null,
    activePrompt: activePrompt()?.name || null
  });
});

app.get('/api/models', (req, res) => {
  res.json({
    activeId: store.data.activeModelId,
    models: store.data.models.map(safeModel)
  });
});

app.post('/api/models', async (req, res, next) => {
  try {
    requireBody(req, ['name', 'baseUrl', 'model']);
    const createdAt = nowIso();
    const model = {
      id: id('model'),
      name: req.body.name.trim(),
      baseUrl: req.body.baseUrl.trim().replace(/\/+$/, ''),
      apiKey: String(req.body.apiKey || ''),
      model: req.body.model.trim(),
      temperature: Number(req.body.temperature ?? 0.8),
      createdAt,
      updatedAt: createdAt
    };
    await store.mutate((data) => {
      data.models.push(model);
      data.activeModelId = model.id;
    });
    res.json({ model: safeModel(model), activeId: model.id });
  } catch (error) {
    next(error);
  }
});

app.put('/api/models/:id', async (req, res, next) => {
  try {
    const model = store.data.models.find((item) => item.id === req.params.id);
    if (!model) return res.status(404).json({ error: '模型配置不存在' });
    await store.mutate(() => {
      if (req.body.name !== undefined) model.name = String(req.body.name).trim();
      if (req.body.baseUrl !== undefined) model.baseUrl = String(req.body.baseUrl).trim().replace(/\/+$/, '');
      if (req.body.apiKey !== undefined) model.apiKey = String(req.body.apiKey);
      if (req.body.model !== undefined) model.model = String(req.body.model).trim();
      if (req.body.temperature !== undefined) model.temperature = Number(req.body.temperature);
      model.updatedAt = nowIso();
    });
    res.json({ model: safeModel(model) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/models/:id/activate', async (req, res) => {
  if (!store.data.models.some((model) => model.id === req.params.id)) {
    return res.status(404).json({ error: '模型配置不存在' });
  }
  await store.mutate((data) => {
    data.activeModelId = req.params.id;
  });
  res.json({ activeId: req.params.id });
});

app.delete('/api/models/:id', async (req, res) => {
  await store.mutate((data) => {
    data.models = data.models.filter((model) => model.id !== req.params.id);
    if (data.activeModelId === req.params.id) data.activeModelId = data.models[0]?.id || null;
  });
  res.json({ ok: true, activeId: store.data.activeModelId });
});

app.post('/api/models/fetch', async (req, res, next) => {
  try {
    const config = req.body.id ? store.data.models.find((model) => model.id === req.body.id) : req.body;
    if (!config) return res.status(404).json({ error: '模型配置不存在' });
    const models = await fetchModels(config);
    res.json({ models });
  } catch (error) {
    next(error);
  }
});

app.get('/api/prompts', (req, res) => {
  res.json({
    activeId: store.data.activePromptId,
    prompts: store.data.prompts
  });
});

app.post('/api/prompts', async (req, res, next) => {
  try {
    requireBody(req, ['name', 'system']);
    const createdAt = nowIso();
    const prompt = {
      id: id('prompt'),
      name: req.body.name.trim(),
      system: req.body.system,
      rewrite: req.body.rewrite || '',
      createdAt,
      updatedAt: createdAt
    };
    await store.mutate((data) => {
      data.prompts.push(prompt);
      data.activePromptId = prompt.id;
    });
    res.json({ prompt, activeId: prompt.id });
  } catch (error) {
    next(error);
  }
});

app.put('/api/prompts/:id', async (req, res) => {
  const prompt = store.data.prompts.find((item) => item.id === req.params.id);
  if (!prompt) return res.status(404).json({ error: '提示词不存在' });
  await store.mutate(() => {
    if (req.body.name !== undefined) prompt.name = String(req.body.name).trim();
    if (req.body.system !== undefined) prompt.system = String(req.body.system);
    if (req.body.rewrite !== undefined) prompt.rewrite = String(req.body.rewrite);
    prompt.updatedAt = nowIso();
  });
  res.json({ prompt });
});

app.post('/api/prompts/:id/activate', async (req, res) => {
  if (!store.data.prompts.some((prompt) => prompt.id === req.params.id)) {
    return res.status(404).json({ error: '提示词不存在' });
  }
  await store.mutate((data) => {
    data.activePromptId = req.params.id;
  });
  res.json({ activeId: req.params.id });
});

app.delete('/api/prompts/:id', async (req, res) => {
  await store.mutate((data) => {
    data.prompts = data.prompts.filter((prompt) => prompt.id !== req.params.id);
    if (data.activePromptId === req.params.id) data.activePromptId = data.prompts[0]?.id || null;
  });
  res.json({ ok: true, activeId: store.data.activePromptId });
});

app.get('/api/conversations', (req, res) => {
  res.json(store.data.conversations.map(publicConversation).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

app.post('/api/conversations', async (req, res) => {
  const createdAt = nowIso();
  const conversation = {
    id: id('conv'),
    title: req.body.title?.trim() || '新角色卡',
    createdAt,
    updatedAt: createdAt,
    messages: []
  };
  await store.mutate((data) => data.conversations.push(conversation));
  res.json(publicConversation(conversation));
});

app.get('/api/conversations/:id', (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: '对话不存在' });
  res.json(conversation);
});

app.put('/api/conversations/:id', async (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: '对话不存在' });
  await store.mutate(() => {
    if (req.body.title !== undefined) conversation.title = String(req.body.title).trim() || conversation.title;
    conversation.updatedAt = nowIso();
  });
  res.json(publicConversation(conversation));
});

app.delete('/api/conversations/:id', async (req, res) => {
  await store.mutate((data) => {
    data.conversations = data.conversations.filter((conversation) => conversation.id !== req.params.id);
  });
  res.json({ ok: true });
});

app.post('/api/conversations/:id/messages', async (req, res) => {
  const conversation = findConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: '对话不存在' });
  const message = {
    id: id('msg'),
    role: req.body.role || 'user',
    content: req.body.content || '',
    createdAt: nowIso()
  };
  await store.mutate(() => {
    conversation.messages.push(message);
    conversation.updatedAt = nowIso();
  });
  res.json(message);
});

app.post('/api/chat', async (req, res, next) => {
  try {
    requireBody(req, ['conversationId', 'message']);
    const conversation = findConversation(req.body.conversationId);
    if (!conversation) return res.status(404).json({ error: '对话不存在' });
    const model = activeModel();
    const prompt = activePrompt();
    if (!model?.apiKey) return res.status(400).json({ error: '请先保存可用的 API Key' });
    if (!prompt) return res.status(400).json({ error: '请先启用提示词' });

    const userMessage = {
      id: id('msg'),
      role: 'user',
      content: req.body.message,
      createdAt: nowIso()
    };
    conversation.messages.push(userMessage);
    conversation.updatedAt = nowIso();
    await store.save();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    let fullText = '';
    const messages = buildMessages({ prompt, conversation: { ...conversation, messages: conversation.messages.slice(0, -1) }, userText: req.body.message });
    await chatStream({
      config: model,
      messages,
      onToken: (token) => {
        fullText += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    });

    const assistantMessage = {
      id: id('msg'),
      role: 'assistant',
      content: fullText,
      createdAt: nowIso()
    };
    await store.mutate(() => {
      conversation.messages.push(assistantMessage);
      conversation.updatedAt = nowIso();
    });
    res.write(`data: ${JSON.stringify({ done: true, message: assistantMessage })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      next(error);
    }
  }
});

app.post('/api/cards/preview', (req, res) => {
  const conversation = findConversation(req.body.conversationId);
  const markdown = req.body.markdown || latestAssistantMarkdown(conversation, req.body.messageId);
  res.json(previewFromMarkdown(markdown));
});

app.post('/api/cards/export', async (req, res, next) => {
  try {
    const conversation = findConversation(req.body.conversationId);
    const markdown = req.body.markdown || latestAssistantMarkdown(conversation, req.body.messageId);
    if (!markdown) return res.status(400).json({ error: '没有可导出的角色卡 Markdown' });
    const cardJson = makeCardJson(markdown, { name: req.body.name, world: req.body.world });
    const safeName = cardJson.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '') || 'character';
    const stamp = Date.now();
    const jsonFile = `${safeName}_${stamp}.json`;
    const mdFile = `${safeName}_${stamp}.md`;
    await fs.writeFile(path.join(exportDir, jsonFile), JSON.stringify(cardJson, null, 2), 'utf8');
    await fs.writeFile(path.join(exportDir, mdFile), markdown, 'utf8');

    let pngFile = null;
    if (req.body.avatarDataUrl) {
      pngFile = `${safeName}_${stamp}.png`;
      await writeCardPng({
        avatarDataUrl: req.body.avatarDataUrl,
        cardJson,
        outputPath: path.join(exportDir, pngFile)
      });
    }
    res.json({
      ok: true,
      name: cardJson.name,
      json: `/exports/${jsonFile}`,
      markdown: `/exports/${mdFile}`,
      png: pngFile ? `/exports/${pngFile}` : null,
      preview: previewFromMarkdown(markdown)
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  res.status(error.status || 500).json({ error: error.message || 'Server error' });
});

app.listen(port, host, () => {
  console.log(`ST Card Web Writer running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

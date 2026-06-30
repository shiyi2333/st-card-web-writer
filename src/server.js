import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JsonStore, id, maskKey, nowIso } from './store.js';
import { defaultStore, buildMessages, importSillyTavernPreset, makeDefaultPromptSet, normalizePrompt, normalizePromptForSave } from './prompts.js';
import { chatStream, fetchModels } from './ai.js';
import { latestAssistantMarkdown, makeCardJson, previewFromMarkdown } from './card.js';
import { writeCardPng } from './png.js';
import {
  ensureInside,
  ensureWorkspace,
  listWorkspaceFiles,
  listWorkspaces,
  moveWorkspaceItem,
  removeWorkspaceItem,
  renameWorkspaceItem,
  resolveWorkspace,
  safeFileName,
  workspaceRoot,
  writeWorkspaceArtifact
} from './workspace.js';
import { searchDanbooru, tavilySearch } from './search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const exportDir = path.resolve(process.env.EXPORT_DIR || path.join(rootDir, 'exports'));
const store = new JsonStore(process.env.STORE_PATH || path.join(rootDir, 'data', 'store.json'));

await store.init(defaultStore());
await migrateStore();
await ensureDefaultWorkspaces();
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

function safeSettings(settings = store.data.settings) {
  return {
    ...settings,
    tavilyKey: maskKey(settings.tavilyKey || ''),
    hasTavilyKey: Boolean(settings.tavilyKey)
  };
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

function findMessage(messageId) {
  for (const conversation of store.data.conversations) {
    const message = conversation.messages.find((item) => item.id === messageId);
    if (message) return { conversation, message };
  }
  return null;
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

async function migrateStore() {
  await store.mutate((data) => {
    data.version = 3;
    data.settings ||= {};
    data.settings.workspaceRoot ||= 'G:\\角色卡';
    data.settings.currentWorkspace ||= '一一';
    data.settings.tavilyKey ||= process.env.TAVILY_API_KEY || '';
    data.settings.agentApprovalMode ||= 'confirm';
    data.settings.imageResultCount ||= 10;
    data.settings.theme ||= 'system';
    data.settings.developerRoleMode ||= 'compat';
    data.settings.carouselTags ||= '1girl solo huge_breasts t-shirt';
    data.usedImages ||= { global: [], workspaces: {} };
    data.usedImages.global ||= [];
    data.usedImages.workspaces ||= {};
    data.imageCache ||= [];
    data.prompts = (data.prompts || []).map(normalizePrompt);
    if (!data.prompts.some((prompt) => prompt.kind === 'lobsterCardV3')) {
      const defaultPrompt = makeDefaultPromptSet();
      data.prompts.unshift(defaultPrompt);
      data.activePromptId = defaultPrompt.id;
    }
    data.models ||= [];
    if (!data.models.length) {
      const createdAt = nowIso();
      const modelId = id('model');
      data.models.push({
        id: modelId,
        name: 'DeepSeek V4 Pro',
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        model: 'deepseek-v4-pro',
        temperature: 0.8,
        createdAt,
        updatedAt: createdAt
      });
      data.activeModelId = modelId;
    }
    data.conversations ||= [];
    for (const conversation of data.conversations) {
      conversation.messages ||= [];
      for (const message of conversation.messages) {
        message.editHistory ||= [];
        message.tools ||= [];
      }
    }
  });
}

async function ensureDefaultWorkspaces() {
  const root = workspaceRoot(store.data.settings);
  await fs.mkdir(root, { recursive: true });
  for (const name of ['金鱼', '一一', 'zz']) {
    await fs.mkdir(path.join(root, name, 'temp'), { recursive: true });
  }
  await ensureWorkspace(store.data.settings);
}

function workspaceUsedImageIds() {
  const name = store.data.settings.currentWorkspace || '';
  return [
    ...(store.data.usedImages.global || []),
    ...(store.data.usedImages.workspaces?.[name] || [])
  ];
}

async function appendToolMessage(conversation, tool) {
  const message = {
    id: id('msg'),
    role: 'tool',
    content: tool.summary || tool.action,
    tool,
    createdAt: nowIso(),
    editHistory: []
  };
  await store.mutate(() => {
    conversation.messages.push(message);
    conversation.updatedAt = nowIso();
  });
  return message;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    port,
    activeModel: activeModel() ? safeModel(activeModel()) : null,
    activePrompt: activePrompt()?.name || null,
    settings: safeSettings()
  });
});

app.get('/api/settings', (req, res) => {
  res.json(safeSettings());
});

app.put('/api/settings', async (req, res) => {
  await store.mutate((data) => {
    if (req.body.workspaceRoot !== undefined) data.settings.workspaceRoot = String(req.body.workspaceRoot).trim() || data.settings.workspaceRoot;
    if (req.body.currentWorkspace !== undefined) data.settings.currentWorkspace = req.body.currentWorkspace ? safeFileName(req.body.currentWorkspace) : '';
    if (req.body.tavilyKey !== undefined) data.settings.tavilyKey = String(req.body.tavilyKey || '');
    if (req.body.agentApprovalMode !== undefined) data.settings.agentApprovalMode = req.body.agentApprovalMode === 'auto' ? 'auto' : 'confirm';
    if (req.body.imageResultCount !== undefined) data.settings.imageResultCount = Number(req.body.imageResultCount) === 5 ? 5 : 10;
    if (req.body.theme !== undefined) data.settings.theme = ['light', 'dark', 'system'].includes(req.body.theme) ? req.body.theme : 'system';
    if (req.body.developerRoleMode !== undefined) data.settings.developerRoleMode = req.body.developerRoleMode === 'native' ? 'native' : 'compat';
    if (req.body.carouselTags !== undefined) data.settings.carouselTags = String(req.body.carouselTags || '').trim() || '1girl solo huge_breasts t-shirt';
  });
  await ensureWorkspace(store.data.settings);
  res.json(safeSettings());
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

app.put('/api/models/:id', async (req, res) => {
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
});

app.post('/api/models/:id/activate', async (req, res) => {
  if (!store.data.models.some((model) => model.id === req.params.id)) return res.status(404).json({ error: '模型配置不存在' });
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
    prompts: store.data.prompts.map(normalizePrompt)
  });
});

app.post('/api/prompts', async (req, res, next) => {
  try {
    requireBody(req, ['name']);
    const prompt = normalizePromptForSave({
      name: req.body.name.trim(),
      messages: req.body.messages
    });
    await store.mutate((data) => {
      data.prompts.push(prompt);
      data.activePromptId = prompt.id;
    });
    res.json({ prompt, activeId: prompt.id });
  } catch (error) {
    next(error);
  }
});

app.post('/api/prompts/import-st', async (req, res, next) => {
  try {
    const { prompt, mapping } = importSillyTavernPreset(req.body || {});
    await store.mutate((data) => {
      data.prompts.push(prompt);
      data.activePromptId = prompt.id;
    });
    res.json({ prompt, mapping, activeId: prompt.id });
  } catch (error) {
    next(error);
  }
});

app.put('/api/prompts/:id', async (req, res) => {
  const existing = store.data.prompts.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: '提示词不存在' });
  const prompt = normalizePromptForSave({
    ...existing,
    name: req.body.name ?? existing.name,
    messages: req.body.messages ?? existing.messages
  });
  await store.mutate((data) => {
    const index = data.prompts.findIndex((item) => item.id === req.params.id);
    data.prompts[index] = prompt;
  });
  res.json({ prompt });
});

app.post('/api/prompts/:id/activate', async (req, res) => {
  if (!store.data.prompts.some((prompt) => prompt.id === req.params.id)) return res.status(404).json({ error: '提示词不存在' });
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
    section: req.body.section || '',
    createdAt: nowIso(),
    editHistory: [],
    tools: []
  };
  await store.mutate(() => {
    conversation.messages.push(message);
    conversation.updatedAt = nowIso();
  });
  res.json(message);
});

app.put('/api/messages/:id', async (req, res) => {
  const found = findMessage(req.params.id);
  if (!found) return res.status(404).json({ error: '消息不存在' });
  await store.mutate(() => {
    found.message.editHistory ||= [];
    found.message.editHistory.push({
      content: found.message.content,
      editedAt: nowIso()
    });
    found.message.content = String(req.body.content || '');
    found.message.updatedAt = nowIso();
    found.conversation.updatedAt = nowIso();
  });
  res.json(found.message);
});

app.post('/api/chat', async (req, res, next) => {
  try {
    requireBody(req, ['conversationId', 'message']);
    const conversation = findConversation(req.body.conversationId);
    if (!conversation) return res.status(404).json({ error: '对话不存在' });
    const model = activeModel();
    const prompt = activePrompt();
    if (!model?.apiKey) return res.status(400).json({ error: '请先保存可用的 API Key' });
    if (!prompt) return res.status(400).json({ error: '请先启用提示词预设' });

    const userMessage = {
      id: id('msg'),
      role: 'user',
      content: req.body.message,
      section: req.body.section || '',
      createdAt: nowIso(),
      editHistory: [],
      tools: []
    };
    conversation.messages.push(userMessage);
    conversation.updatedAt = nowIso();
    await store.save();

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    let fullText = '';
    const messages = buildMessages({
      prompt,
      conversation: { ...conversation, messages: conversation.messages.slice(0, -1) },
      userText: req.body.message,
      section: req.body.section || '',
      developerRoleMode: store.data.settings.developerRoleMode || 'compat'
    });
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
      section: req.body.section || '',
      createdAt: nowIso(),
      editHistory: [],
      tools: []
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
    const cardJson = makeCardJson(markdown, { name: req.body.name, world: req.body.world, selectedImage: req.body.selectedImage || null });
    const safeName = safeFileName(cardJson.name, 'character');
    const stamp = Date.now();
    const jsonFile = `${safeName}_${stamp}.json`;
    const mdFile = `${safeName}_${stamp}.md`;
    const workspace = await ensureWorkspace(store.data.settings);
    const jsonPath = await writeWorkspaceArtifact(store.data.settings, jsonFile, JSON.stringify(cardJson, null, 2), { temp: false });
    const mdPath = await writeWorkspaceArtifact(store.data.settings, mdFile, markdown, { temp: false });

    let pngPath = null;
    if (req.body.avatarDataUrl) {
      const pngFile = `${safeName}_${stamp}.png`;
      pngPath = path.join(workspace.dir, pngFile);
      await writeCardPng({
        avatarDataUrl: req.body.avatarDataUrl,
        cardJson,
        outputPath: pngPath
      });
    }
    if (conversation) {
      await appendToolMessage(conversation, {
        action: 'export-card',
        status: 'ok',
        summary: `已导出角色卡: ${cardJson.name}`,
        result: {
          workspace: workspace.name,
          json: path.basename(jsonPath),
          markdown: path.basename(mdPath),
          png: pngPath ? path.basename(pngPath) : null
        },
        createdAt: nowIso()
      });
    }
    res.json({
      ok: true,
      name: cardJson.name,
      json: `/api/workspaces/file?name=${encodeURIComponent(path.basename(jsonPath))}`,
      markdown: `/api/workspaces/file?name=${encodeURIComponent(path.basename(mdPath))}`,
      png: pngPath ? `/api/workspaces/file?name=${encodeURIComponent(path.basename(pngPath))}` : null,
      workspace: workspace.name,
      preview: previewFromMarkdown(markdown)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/workspaces', async (req, res, next) => {
  try {
    const names = await listWorkspaces(store.data.settings);
    res.json({ root: workspaceRoot(store.data.settings), current: store.data.settings.currentWorkspace, workspaces: names });
  } catch (error) {
    next(error);
  }
});

app.post('/api/workspaces', async (req, res, next) => {
  try {
    requireBody(req, ['name']);
    const name = safeFileName(req.body.name, '新工作区');
    const root = workspaceRoot(store.data.settings);
    await fs.mkdir(ensureInside(root, path.join(root, name, 'temp')), { recursive: true });
    await store.mutate((data) => {
      data.settings.currentWorkspace = name;
      data.usedImages.workspaces[name] ||= [];
    });
    res.json({ ok: true, current: name, workspaces: await listWorkspaces(store.data.settings) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/workspaces/name', async (req, res, next) => {
  try {
    requireBody(req, ['from', 'to']);
    const root = workspaceRoot(store.data.settings);
    const from = safeFileName(req.body.from);
    const to = safeFileName(req.body.to);
    const source = ensureInside(root, path.join(root, from));
    const target = ensureInside(root, path.join(root, to));
    await fs.rename(source, target);
    await store.mutate((data) => {
      if (data.settings.currentWorkspace === from) data.settings.currentWorkspace = to;
      data.usedImages.workspaces[to] ||= data.usedImages.workspaces[from] || [];
      delete data.usedImages.workspaces[from];
    });
    res.json({ ok: true, current: store.data.settings.currentWorkspace, workspaces: await listWorkspaces(store.data.settings) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/workspaces', async (req, res, next) => {
  try {
    requireBody(req, ['name']);
    const root = workspaceRoot(store.data.settings);
    const name = safeFileName(req.body.name);
    const target = ensureInside(root, path.join(root, name));
    await fs.rm(target, { recursive: true, force: true });
    const names = await listWorkspaces(store.data.settings);
    await store.mutate((data) => {
      delete data.usedImages.workspaces[name];
      if (data.settings.currentWorkspace === name) data.settings.currentWorkspace = names.includes('一一') ? '一一' : names[0] || '一一';
    });
    await ensureWorkspace(store.data.settings);
    res.json({ ok: true, current: store.data.settings.currentWorkspace, workspaces: await listWorkspaces(store.data.settings) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/workspaces/current', async (req, res, next) => {
  try {
    const name = safeFileName(req.body.name || '默认工作区', '默认工作区');
    await store.mutate((data) => {
      data.settings.currentWorkspace = name;
      data.usedImages.workspaces[name] ||= [];
    });
    await ensureWorkspace(store.data.settings);
    res.json({ ok: true, settings: safeSettings(), files: await listWorkspaceFiles(store.data.settings) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/workspaces/files', async (req, res, next) => {
  try {
    res.json({ files: await listWorkspaceFiles(store.data.settings) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/workspaces/item', async (req, res, next) => {
  try {
    requireBody(req, ['name']);
    await removeWorkspaceItem(store.data.settings, req.body.name);
    res.json({ ok: true, files: await listWorkspaceFiles(store.data.settings) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/workspaces/item', async (req, res, next) => {
  try {
    requireBody(req, ['from', 'to']);
    await renameWorkspaceItem(store.data.settings, req.body.from, req.body.to);
    res.json({ ok: true, files: await listWorkspaceFiles(store.data.settings) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/workspaces/move', async (req, res, next) => {
  try {
    requireBody(req, ['fromWorkspace', 'itemName', 'toWorkspace']);
    await moveWorkspaceItem(store.data.settings, req.body.fromWorkspace, req.body.itemName, req.body.toWorkspace);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/workspaces/file', async (req, res, next) => {
  try {
    const workspace = resolveWorkspace(store.data.settings);
    const target = ensureInside(workspace.root, path.join(workspace.dir, safeFileName(req.query.name || '')));
    res.download(target);
  } catch (error) {
    next(error);
  }
});

app.post('/api/images/search', async (req, res, next) => {
  try {
    const usedIds = workspaceUsedImageIds();
    const payload = await searchDanbooru({
      tags: req.body.tags || '',
      limit: req.body.limit || store.data.settings.imageResultCount,
      usedIds,
      page: req.body.page || 1,
      offset: req.body.offset || 0
    });
    await store.mutate((data) => {
      const ids = new Set((data.imageCache || []).map((item) => String(item.id)));
      data.imageCache ||= [];
      for (const image of payload.results) {
        if (!ids.has(String(image.id))) data.imageCache.unshift(image);
      }
      data.imageCache = data.imageCache.slice(0, 80);
    });
    res.json({ ...payload, usedIds });
  } catch (error) {
    next(error);
  }
});

app.get('/api/images/carousel', async (req, res, next) => {
  try {
    const tags = req.query.tags || store.data.settings.carouselTags || '1girl solo huge_breasts t-shirt';
    try {
      const payload = await searchDanbooru({ tags, limit: 10, usedIds: [], page: 1, includeUsed: true });
      await store.mutate((data) => {
        data.imageCache ||= [];
        const ids = new Set(data.imageCache.map((item) => String(item.id)));
        for (const image of payload.results) {
          if (!ids.has(String(image.id))) data.imageCache.unshift(image);
        }
        data.imageCache = data.imageCache.slice(0, 80);
      });
      res.json({ ...payload, source: 'live' });
    } catch (error) {
      res.json({
        tags: String(tags).split(/\s+/).filter(Boolean),
        queryTags: [],
        results: store.data.imageCache || [],
        source: 'cache',
        warning: error.message
      });
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/images/use', async (req, res) => {
  const imageId = String(req.body.id || '');
  if (!imageId) return res.status(400).json({ error: '缺少图片 id' });
  const workspaceName = store.data.settings.currentWorkspace || '';
  await store.mutate((data) => {
    data.usedImages.global ||= [];
    data.usedImages.workspaces ||= {};
    data.usedImages.workspaces[workspaceName] ||= [];
    if (!data.usedImages.global.includes(imageId)) data.usedImages.global.push(imageId);
    if (!data.usedImages.workspaces[workspaceName].includes(imageId)) data.usedImages.workspaces[workspaceName].push(imageId);
  });
  res.json({ ok: true, usedIds: workspaceUsedImageIds() });
});

app.get('/api/images/proxy', async (req, res, next) => {
  try {
    const url = String(req.query.url || '');
    if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: '图片 URL 无效' });
    const response = await fetch(url, { headers: { 'User-Agent': 'st-card-web-writer/1.0' } });
    if (!response.ok) return res.status(response.status).json({ error: '图片下载失败' });
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.post('/api/web-search', async (req, res, next) => {
  try {
    const result = await tavilySearch({
      apiKey: store.data.settings.tavilyKey,
      query: req.body.query,
      maxResults: req.body.maxResults || 5
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/agent/actions', async (req, res, next) => {
  try {
    requireBody(req, ['conversationId', 'action']);
    const conversation = findConversation(req.body.conversationId);
    if (!conversation) return res.status(404).json({ error: '对话不存在' });
    let result;
    if (req.body.action === 'image-search') {
      result = await searchDanbooru({ tags: req.body.tags, limit: req.body.limit || 10, usedIds: workspaceUsedImageIds(), page: req.body.page || 1, offset: req.body.offset || 0 });
      await store.mutate((data) => {
        data.imageCache ||= [];
        const ids = new Set(data.imageCache.map((item) => String(item.id)));
        for (const image of result.results) {
          if (!ids.has(String(image.id))) data.imageCache.unshift(image);
        }
        data.imageCache = data.imageCache.slice(0, 80);
      });
    } else if (req.body.action === 'web-search') {
      result = await tavilySearch({ apiKey: store.data.settings.tavilyKey, query: req.body.query, maxResults: req.body.maxResults || 5 });
    } else if (req.body.action === 'export-card') {
      const markdown = req.body.markdown || latestAssistantMarkdown(conversation, req.body.messageId);
      const cardJson = makeCardJson(markdown, { selectedImage: req.body.selectedImage || null });
      result = { preview: previewFromMarkdown(markdown), cardJson };
    } else if (req.body.action === 'workspace-write') {
      requireBody(req, ['fileName', 'content']);
      const target = await writeWorkspaceArtifact(store.data.settings, req.body.fileName, req.body.content, { temp: Boolean(req.body.temp) });
      result = { path: target };
    } else {
      return res.status(400).json({ error: '未知 agent 动作' });
    }
    const toolMessage = await appendToolMessage(conversation, {
      action: req.body.action,
      status: 'ok',
      summary: `工具已完成: ${req.body.action}`,
      input: req.body,
      result,
      createdAt: nowIso()
    });
    res.json({ ok: true, result, toolMessage });
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

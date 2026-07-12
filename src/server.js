import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JsonStore, id, maskKey, nowIso } from './store.js';
import { defaultStore, buildMessages, ensurePromptSkillCatalog, importSillyTavernPreset, makeDefaultPromptSet, normalizePrompt, normalizePromptForSave } from './prompts.js';
import { chatJson, chatStream, chatText, fetchModels } from './ai.js';
import { latestAssistantMarkdown, makeCardJson, previewFromMarkdown } from './card.js';
import { writeCardPng } from './png.js';
import {
  ensureInside,
  ensureWorkspace,
  defaultWorkspaceRoot,
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
import { tavilySearch } from './search.js';
import { searchDanbooru } from './danbooru.js';
import { listSkillFileTree, readSkillCatalog, readSkillFile, saveSkillFile } from './skills.js';
import { CardQueue } from './queue.js';
import { validateCardMarkdown, validationRepairPrompt } from './validator.js';
import { readWorkspaceIndex, recordWorkspaceCard } from './workspace-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const exportDir = path.resolve(process.env.EXPORT_DIR || path.join(rootDir, 'exports'));
const store = new JsonStore(process.env.STORE_PATH || path.join(rootDir, 'data', 'store.json'));

await store.init(defaultStore({ workspaceRoot: defaultWorkspaceRoot() }));
await migrateStore();
await ensureDefaultWorkspaces();
await fs.mkdir(exportDir, { recursive: true });

const app = express();
const port = Number(process.env.PORT || 5679);
const host = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '30mb' }));
app.use(express.static(publicDir));
app.use('/exports', express.static(exportDir));

function safeModel(model) {
  return { provider: 'openai', ...model, apiKey: maskKey(model.apiKey) };
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
    data.version = 4;
    data.settings ||= {};
    if (!data.settings.workspaceRoot || (process.platform !== 'win32' && /^G:\\/i.test(data.settings.workspaceRoot))) {
      data.settings.workspaceRoot = defaultWorkspaceRoot();
    }
    data.settings.currentWorkspace ||= '一一';
    data.settings.tavilyKey ||= process.env.TAVILY_API_KEY || '';
    data.settings.agentApprovalMode ||= 'confirm';
    data.settings.imageResultCount ||= 10;
    data.settings.theme ||= 'system';
    data.settings.developerRoleMode ||= 'compat';
    data.settings.carouselTags ||= '1girl solo huge_breasts t-shirt';
    data.settings.thinkBlockRegex ||= '<Think>([\\s\\S]*?)</Think>';
    data.settings.thinkBlockRegexFlags ||= 'gi';
    data.usedImages ||= { global: [], workspaces: {} };
    data.usedImages.global ||= [];
    data.usedImages.workspaces ||= {};
    data.imageCache ||= [];
    data.cardQueue ||= { tasks: [] };
    data.cardQueue.tasks ||= [];
    data.prompts ||= [];
    let generalPrompt = data.prompts.find((prompt) => prompt.kind === 'generalAssistantV1');
    if (!generalPrompt) {
      const defaultPrompt = makeDefaultPromptSet();
      data.prompts.unshift(defaultPrompt);
      generalPrompt = defaultPrompt;
    }
    const activePrompt = data.prompts.find((prompt) => prompt.id === data.activePromptId);
    if (!activePrompt || activePrompt.kind === 'lobsterCardV3') {
      data.activePromptId = generalPrompt.id;
    }
    data.models ||= [];
    for (const model of data.models) {
      model.provider = model.provider === 'anthropic' ? 'anthropic' : 'openai';
    }
    if (!data.models.length) {
      const createdAt = nowIso();
      const modelId = id('model');
      data.models.push({
        id: modelId,
        name: 'DeepSeek V4 Pro',
        provider: 'openai',
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

async function chatTextForQueue(userText) {
  const model = activeModel();
  const prompt = activePrompt();
  if (!model?.apiKey) {
    const error = new Error('请先保存可用的 API Key');
    error.status = 400;
    throw error;
  }
  if (!prompt) {
    const error = new Error('请先启用提示词预设');
    error.status = 400;
    throw error;
  }
  const skills = await readSkillCatalog();
  const selectedSkills = ['character-card-writer', 'st-card-style-guide'].filter((skillId) => skills.some((skill) => skill.id === skillId));
  const messages = buildMessages({
    prompt,
    conversation: { messages: [] },
    userText,
    section: '',
    developerRoleMode: store.data.settings.developerRoleMode || 'compat',
    selectedSkills,
    skillCatalog: skills,
    toolResults: []
  });
  return chatText({ config: model, messages, temperature: Number(model.temperature ?? 0.8) });
}

async function makeQueueConversation({ title, userText, assistantText }) {
  const createdAt = nowIso();
  const conversation = {
    id: id('conv'),
    title: String(title || '队列角色卡').trim(),
    createdAt,
    updatedAt: createdAt,
    messages: [
      {
        id: id('msg'),
        role: 'user',
        content: userText || '',
        section: '',
        skills: ['character-card-writer', 'st-card-style-guide'],
        createdAt,
        editHistory: [],
        tools: []
      },
      {
        id: id('msg'),
        role: 'assistant',
        content: assistantText || '',
        section: '',
        createdAt,
        editHistory: [],
        tools: []
      }
    ]
  };
  await store.mutate((data) => data.conversations.push(conversation));
  return conversation.id;
}

async function exportCardFromMarkdown({ markdown, conversationId, taskId = '', itemId = '', validation = null }) {
  if (!markdown) {
    const error = new Error('没有可导出的角色卡 Markdown');
    error.status = 400;
    throw error;
  }
  const conversation = findConversation(conversationId);
  const cardValidation = validation || validateCardMarkdown(markdown);
  const cardJson = makeCardJson(markdown);
  const safeName = safeFileName(cardJson.name, 'character');
  const stamp = Date.now();
  const jsonFile = `${safeName}_${stamp}.json`;
  const mdFile = `${safeName}_${stamp}.md`;
  const workspace = await ensureWorkspace(store.data.settings);
  const jsonPath = await writeWorkspaceArtifact(store.data.settings, jsonFile, JSON.stringify(cardJson, null, 2), { temp: false });
  const mdPath = await writeWorkspaceArtifact(store.data.settings, mdFile, markdown, { temp: false });
  const result = {
    ok: true,
    name: cardJson.name,
    workspace: workspace.name,
    json: `/api/workspaces/file?name=${encodeURIComponent(path.basename(jsonPath))}`,
    markdown: `/api/workspaces/file?name=${encodeURIComponent(path.basename(mdPath))}`,
    preview: { ...previewFromMarkdown(markdown), validation: cardValidation },
    validation: cardValidation
  };
  await recordWorkspaceCard(store.data.settings, {
    id: `${safeName}_${stamp}`,
    name: cardJson.name,
    source: 'queue',
    taskId,
    itemId,
    conversationId,
    json: path.basename(jsonPath),
    markdown: path.basename(mdPath),
    validation: cardValidation
  });
  if (conversation) {
    await appendToolMessage(conversation, {
      action: 'export-card',
      status: 'ok',
      summary: `已导出队列角色卡: ${cardJson.name}`,
      result: {
        workspace: workspace.name,
        json: path.basename(jsonPath),
        markdown: path.basename(mdPath)
      },
      createdAt: nowIso()
    });
  }
  return result;
}

const cardQueue = new CardQueue({
  id,
  now: nowIso,
  store,
  chatText: chatTextForQueue,
  exportCard: exportCardFromMarkdown,
  makeConversation: makeQueueConversation,
  validateCard: validateCardMarkdown,
  repairPrompt: validationRepairPrompt
});

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

function sse(res, event, payload = {}) {
  res.write(`data: ${JSON.stringify({ event, ...payload })}\n\n`);
}

function toolSummary(action, result) {
  if (action === 'web-search') return `网页搜索完成：${result.results?.length || 0} 条结果`;
  if (action === 'image-search') return `Danbooru 搜图完成：${result.results?.length || 0} 张候选`;
  if (action === 'export-card') return '角色卡导出数据已准备';
  if (action === 'queue-create-task') return `已创建 ${result.tasks?.length || 0} 个写卡队列任务`;
  if (action === 'ask-user') return result.title || '需要你先确认几个选项';
  if (action === 'workspace-write') return `已写入文件：${result.path || ''}`;
  if (action === 'card-section-rewrite') return '已进入单区块重写模式';
  return `工具已完成: ${action}`;
}

function toolMethod(action) {
  return {
    'web-search': 'tavilySearch',
    'image-search': 'searchDanbooru',
    'export-card': 'makeCardJson + previewFromMarkdown',
    'queue-create-task': 'CardQueue.createTask',
    'ask-user': 'agentQuestionnaire',
    'workspace-write': 'writeWorkspaceArtifact',
    'card-section-rewrite': 'sectionTargeting',
    'skill-prompt': 'skillPromptInjection'
  }[action] || 'agentAction';
}

function countFromText(text = '', fallback = 3) {
  const match = String(text).match(/(\d{1,2})\s*(张|个|份|cards?|roles?|角色)?/i);
  return Math.max(1, Math.min(Number(match?.[1]) || fallback, 20));
}

function normalizeQueueTaskInput(input = {}, userText = '') {
  const mode = input.mode === 'direct' ? 'direct' : 'outline';
  const count = Math.max(1, Math.min(Number(input.count) || countFromText(userText), 20));
  const seedText = String(input.seedText || input.brief || input.prompt || userText || '').trim();
  const itemsText = Array.isArray(input.items)
    ? input.items.map((item) => typeof item === 'string' ? item : [item.title, item.brief].filter(Boolean).join(': ')).filter(Boolean).join('\n')
    : String(input.itemsText || '').trim();
  return {
    title: String(input.title || '').trim() || (mode === 'outline' ? 'AI 批次设定任务' : 'AI 多卡生成任务'),
    mode,
    count,
    seedText,
    itemsText,
    autoExport: input.autoExport !== false,
    reviewBeforeRun: input.reviewBeforeRun !== false
  };
}

function normalizeQuestionnaireInput(input = {}, userText = '') {
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  const questions = rawQuestions.slice(0, 6).map((question, index) => {
    let type = ['choice', 'text', 'textarea', 'number'].includes(question.type) ? question.type : 'choice';
    const options = Array.isArray(question.options)
      ? question.options.slice(0, 8).map((option) => String(option.label || option.value || option).trim()).filter(Boolean)
      : [];
    if (type === 'choice' && !options.length) type = 'textarea';
    return {
      id: String(question.id || `q${index + 1}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || `q${index + 1}`,
      label: String(question.label || question.question || `问题 ${index + 1}`).trim(),
      type,
      required: question.required !== false,
      placeholder: String(question.placeholder || '').trim(),
      options
    };
  }).filter((question) => question.label);
  return {
    id: id('questionnaire'),
    title: String(input.title || '需要你先确认一下').trim(),
    intro: String(input.intro || input.description || userText || '').trim(),
    questions: questions.length ? questions : [
      {
        id: 'direction',
        label: '你希望这批角色卡优先走哪种方向？',
        type: 'textarea',
        required: true,
        placeholder: '例如：校园、都市、奇幻、偏日常、偏剧情推进',
        options: []
      }
    ],
    submitLabel: String(input.submitLabel || '提交并继续').trim(),
    followupPrefix: String(input.followupPrefix || '请根据下面的问卷答案继续处理：').trim()
  };
}

function normalizeActionInput(action, input = {}, userText = '') {
  if (action === 'web-search') return { query: input.query || userText, maxResults: input.maxResults || 5 };
  if (action === 'image-search') return { tags: input.tags || userText, limit: input.limit || store.data.settings.imageResultCount || 10, page: input.page || 1 };
  if (action === 'export-card') return { messageId: input.messageId || '', markdown: input.markdown || '', selectedImage: input.selectedImage || null };
  if (action === 'queue-create-task') {
    const rawTasks = Array.isArray(input.tasks) && input.tasks.length ? input.tasks : [input];
    return {
      tasks: rawTasks.slice(0, 6).map((task) => normalizeQueueTaskInput(task, userText)),
      start: Boolean(input.start || input.run)
    };
  }
  if (action === 'ask-user') return normalizeQuestionnaireInput(input, userText);
  if (action === 'workspace-write') return { fileName: input.fileName || '', content: input.content || '', temp: Boolean(input.temp) };
  if (action === 'card-section-rewrite') return { section: input.section || '', instruction: input.instruction || userText };
  return input;
}

async function executeAgentAction(action, input, conversation, emit = null) {
  let result;
  if (action === 'image-search') {
    emit?.('skill_progress', { action, message: '连接 Danbooru 并搜索候选图片' });
    result = await searchDanbooru({ tags: input.tags, limit: input.limit || 10, usedIds: workspaceUsedImageIds(), page: input.page || 1, offset: input.offset || 0 });
    await store.mutate((data) => {
      data.imageCache ||= [];
      const ids = new Set(data.imageCache.map((item) => String(item.id)));
      for (const image of result.results) {
        if (!ids.has(String(image.id))) data.imageCache.unshift(image);
      }
      data.imageCache = data.imageCache.slice(0, 80);
    });
  } else if (action === 'web-search') {
    emit?.('skill_progress', { action, message: `连接 Tavily：${input.query}` });
    result = await tavilySearch({ apiKey: store.data.settings.tavilyKey, query: input.query, maxResults: input.maxResults || 5 });
  } else if (action === 'export-card') {
    emit?.('skill_progress', { action, message: '读取当前角色卡并生成 Tavern Card JSON' });
    const markdown = input.markdown || latestAssistantMarkdown(conversation, input.messageId);
    const cardJson = makeCardJson(markdown, { selectedImage: input.selectedImage || null });
    result = { preview: previewFromMarkdown(markdown), cardJson };
  } else if (action === 'queue-create-task') {
    emit?.('skill_progress', { action, message: `创建 ${input.tasks?.length || 0} 个写卡队列任务` });
    const tasks = [];
    for (const taskInput of input.tasks || []) {
      const task = await cardQueue.createTask(taskInput);
      tasks.push(task);
    }
    if (input.start) {
      cardQueue.resume().catch((error) => console.error('queue run failed:', error));
    }
    result = { tasks, queue: cardQueue.snapshot(), started: Boolean(input.start) };
  } else if (action === 'ask-user') {
    result = input;
  } else if (action === 'workspace-write') {
    requireBody({ body: input }, ['fileName', 'content']);
    emit?.('skill_progress', { action, message: `写入工作区文件：${input.fileName}` });
    const target = await writeWorkspaceArtifact(store.data.settings, input.fileName, input.content, { temp: Boolean(input.temp) });
    result = { path: target };
  } else if (action === 'card-section-rewrite') {
    result = { section: input.section || '', instruction: input.instruction || '' };
  } else {
    const error = new Error('未知 agent 动作');
    error.status = 400;
    throw error;
  }

  const toolMessage = await appendToolMessage(conversation, {
    action,
    method: toolMethod(action),
    status: 'ok',
    summary: toolSummary(action, result),
    input,
    result,
    createdAt: nowIso()
  });
  return { result, toolMessage };
}

function fallbackPlanFromText(text = '', selectedSkills = []) {
  const actions = [];
  const lower = String(text).toLowerCase();
  const selected = new Set(selectedSkills || []);
  if (selected.has('web-search') || /搜索|查一下|联网|网页|资料|来源|news|latest/.test(text)) {
    actions.push({ action: 'web-search', input: { query: text, maxResults: 5 }, reason: '用户需要网页资料' });
  }
  if (selected.has('image-search') || /搜图|找图|danbooru|配图|换图/.test(lower)) {
    actions.push({ action: 'image-search', input: { tags: text, limit: store.data.settings.imageResultCount || 10 }, reason: '用户需要图片候选' });
  }
  if (selected.has('export-card') || /导出|png|json|落盘/.test(lower)) {
    actions.push({ action: 'export-card', input: {}, reason: '用户需要导出角色卡' });
  }
  if (selected.has('batch-card-planner') || (/(队列|批次|多张|多个角色|一批|batch|queue)/i.test(text) && /(生成|创建|设置|安排|做|写|列举|建议)/.test(text))) {
    actions.push({
      action: 'queue-create-task',
      input: {
        title: 'AI 批次写卡任务',
        mode: /直接|逐条|每行/.test(text) ? 'direct' : 'outline',
        count: countFromText(text, 3),
        seedText: text,
        autoExport: true,
        reviewBeforeRun: true
      },
      reason: '用户需要创建多角色卡队列'
    });
  }
  return actions.slice(0, 3);
}

function fallbackSkillIdsFromText(text = '', selectedSkills = []) {
  const ids = new Set((selectedSkills || []).map(String));
  const value = String(text || '').toLowerCase();
  if (/角色卡|写卡|改卡|st\b|sillytavern|tavern|作者备注|开场白|first message|预览卡|导出卡/.test(value)) {
    ids.add('character-card-writer');
    ids.add('st-card-style-guide');
  }
  if (/(队列|批次|多张|多个角色|一批|batch|queue)/i.test(text)) {
    ids.add('batch-card-planner');
    ids.add('character-card-writer');
    ids.add('st-card-style-guide');
  }
  if (/肉感|安产|成人文风|色情文风|情色文风|openclaw|肥尻|宽胯|巨乳/.test(value)) {
    ids.add('openclaw-erotic-style');
  }
  return [...ids];
}

async function planSkillActions({ model, conversation, userText, section, selectedSkills, skills }) {
  const allowedActions = new Set(['web-search', 'image-search', 'export-card', 'workspace-write', 'card-section-rewrite', 'queue-create-task', 'ask-user']);
  const allowedSkills = new Set((skills || []).map((skill) => skill.id));
  const selected = Array.isArray(selectedSkills) ? selectedSkills : [];
  try {
    const payload = await chatJson({
      config: model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            '你是 skill planner。只输出 JSON，不要解释。',
            'JSON 格式：{"skills":["skill-id"],"actions":[{"action":"web-search|image-search|export-card|workspace-write|card-section-rewrite|queue-create-task|ask-user","input":{},"reason":"简短原因"}]}',
            '只有用户明确需要工具时才返回 action；普通聊天返回 {"actions":[]}.',
            '当用户要求批量写卡、创建多张角色卡、先列设定再逐张完善时，可以使用 queue-create-task。input 可以是单个任务，也可以是 {"tasks":[...]}；mode 为 outline 或 direct；默认 reviewBeforeRun=true。',
            '当写卡方向、数量、题材、尺度、导出方式等信息不足且继续执行会偏离用户习惯时，可以使用 ask-user 创建前端问卷。问卷问题应简洁，最多 6 个。',
            'queue-create-task 默认只创建队列；除非用户明确说立刻开始/直接跑，否则不要设置 start=true。',
            '如果用户需要某个纯提示词风格 skill，可以只返回 skills，不需要虚构 action。',
            '写卡、改卡、作者备注、开场白、ST/SillyTavern 相关请求应优先选择 character-card-writer 和 st-card-style-guide；成人肉感/安产型文风请求可选择 openclaw-erotic-style。',
            '不要执行删除、移动等危险文件操作。',
            `可用 skills：${JSON.stringify(skills.map(({ id, name, description, actions, triggers, inputs, outputs, requiresConfirmation }) => ({ id, name, description, actions, triggers, inputs, outputs, requiresConfirmation })))}`
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            message: userText,
            targetSection: section || '',
            selectedSkills: selected,
            recentMessages: (conversation.messages || []).slice(-6).map((message) => ({ role: message.role, content: message.content?.slice(0, 500) }))
          })
        }
      ]
    });
    const planned = Array.isArray(payload.actions) ? payload.actions : [];
    const plannedSkills = Array.isArray(payload.skills)
      ? payload.skills.map(String).filter((skillId) => allowedSkills.has(skillId))
      : [];
    return {
      skills: [...new Set([...fallbackSkillIdsFromText(userText, selected), ...plannedSkills].filter((skillId) => allowedSkills.has(skillId)))],
      actions: planned
        .filter((item) => allowedActions.has(item.action))
        .slice(0, 3)
        .map((item) => ({
          action: item.action,
          input: normalizeActionInput(item.action, item.input || {}, userText),
          reason: item.reason || ''
        }))
    };
  } catch {
    return {
      skills: fallbackSkillIdsFromText(userText, selected).filter((skillId) => allowedSkills.has(skillId)),
      actions: fallbackPlanFromText(userText, selected).map((item) => ({
        ...item,
        input: normalizeActionInput(item.action, item.input || {}, userText)
      }))
    };
  }
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

app.get('/api/device-paths', (req, res) => {
  res.json({
    platform: process.platform,
    defaultWorkspaceRoot: defaultWorkspaceRoot(),
    activeWorkspaceRoot: workspaceRoot(store.data.settings)
  });
});

app.get('/api/skills', (req, res) => {
  readSkillCatalog({ refresh: req.query.refresh === '1' })
    .then((skills) => res.json({ skills }))
    .catch((error) => res.status(500).json({ error: error.message }));
});

app.get('/api/skills/manifest', (req, res) => {
  readSkillCatalog({ refresh: req.query.refresh === '1' })
    .then((skills) => res.json({
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        category: skill.category,
        description: skill.description,
        actions: skill.actions || [],
        triggers: skill.triggers || [],
        inputs: skill.inputs || [],
        outputs: skill.outputs || [],
        requiresConfirmation: Boolean(skill.requiresConfirmation)
      }))
    }))
    .catch((error) => res.status(500).json({ error: error.message }));
});

app.get('/api/skill-files/tree', (req, res) => {
  listSkillFileTree()
    .then((payload) => res.json(payload))
    .catch((error) => res.status(500).json({ error: error.message }));
});

app.get('/api/skill-files/file', (req, res) => {
  readSkillFile(req.query.path)
    .then((payload) => res.json(payload))
    .catch((error) => res.status(400).json({ error: error.message }));
});

app.put('/api/skill-files/file', (req, res) => {
  saveSkillFile(req.body.path, req.body.content)
    .then((payload) => res.json(payload))
    .catch((error) => res.status(400).json({ error: error.message }));
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
    if (req.body.thinkBlockRegex !== undefined) data.settings.thinkBlockRegex = String(req.body.thinkBlockRegex || '').trim() || '<Think>([\\s\\S]*?)</Think>';
    if (req.body.thinkBlockRegexFlags !== undefined) {
      const flags = [...new Set(String(req.body.thinkBlockRegexFlags || 'gi').replace(/[^dgimsuvy]/g, '').split(''))].join('');
      data.settings.thinkBlockRegexFlags = flags.includes('g') ? flags : `${flags}g`;
    }
    if (req.body.useDeviceDefaultWorkspaceRoot) data.settings.workspaceRoot = defaultWorkspaceRoot();
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
      provider: req.body.provider === 'anthropic' ? 'anthropic' : 'openai',
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
    if (req.body.provider !== undefined) model.provider = req.body.provider === 'anthropic' ? 'anthropic' : 'openai';
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
    const { prompt, prompts = [prompt], mapping, mappings = [] } = importSillyTavernPreset(req.body || {});
    const validPrompts = prompts.filter(Boolean);
    const activePrompt = validPrompts.find((item) => item.id === prompt?.id) || validPrompts.at(-1) || prompt;
    await store.mutate((data) => {
      data.prompts.push(...validPrompts);
      data.activePromptId = activePrompt.id;
    });
    res.json({ prompt: activePrompt, prompts: validPrompts, mapping, mappings, activeId: activePrompt.id });
  } catch (error) {
    next(error);
  }
});

app.post('/api/prompts/import', async (req, res, next) => {
  try {
    const source = req.body?.prompt || req.body;
    if (!source || !Array.isArray(source.messages)) {
      const error = new Error('不是本项目预设 JSON：缺少 prompt.messages');
      error.status = 400;
      throw error;
    }
    const prompt = normalizePromptForSave({
      ...source,
      id: id('prompt'),
      name: source.name ? `${source.name}（导入）` : '导入预设',
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    await store.mutate((data) => {
      data.prompts.push(prompt);
      data.activePromptId = prompt.id;
    });
    res.json({ prompt, prompts: [prompt], mapping: [], mappings: [], activeId: prompt.id });
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
    const skills = await readSkillCatalog();
    const previousMessages = [...conversation.messages];

    const userMessage = {
      id: id('msg'),
      role: 'user',
      content: req.body.message,
      section: req.body.section || '',
      skills: Array.isArray(req.body.selectedSkills) ? req.body.selectedSkills.map(String) : [],
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
    const toolResults = [];
    const plan = await planSkillActions({
      model,
      conversation: { ...conversation, messages: previousMessages },
      userText: req.body.message,
      section: req.body.section || '',
      selectedSkills: req.body.selectedSkills || [],
      skills
    });
    const selectedSkillIds = [...new Set([...(req.body.selectedSkills || []).map(String), ...(plan.skills || [])])];
    for (const skillId of selectedSkillIds) {
      const skill = skills.find((item) => item.id === skillId);
      if (!skill || skill.actions?.length) continue;
      const toolId = `skill_${Date.now()}_${skillId}`;
      const input = { skillId, name: skill.name };
      const result = { skillId, name: skill.name, category: skill.category };
      sse(res, 'skill_start', { toolId, action: 'skill-prompt', method: toolMethod('skill-prompt'), reason: '注入纯提示词 skill', input });
      const toolMessage = await appendToolMessage(conversation, {
        action: 'skill-prompt',
        method: toolMethod('skill-prompt'),
        status: 'ok',
        summary: `已注入 skill：${skill.name}`,
        input,
        result,
        createdAt: nowIso()
      });
      sse(res, 'skill_result', { toolId, action: 'skill-prompt', method: toolMethod('skill-prompt'), result, toolMessage });
    }

    for (const [index, planned] of plan.actions.entries()) {
      const toolId = `tool_${Date.now()}_${index}`;
      const input = normalizeActionInput(planned.action, planned.input || {}, req.body.message);
      sse(res, 'skill_start', { toolId, action: planned.action, method: toolMethod(planned.action), reason: planned.reason || '', input });
      try {
        const { result, toolMessage } = await executeAgentAction(planned.action, input, conversation, (event, payload) => {
          sse(res, event, { toolId, ...payload });
        });
        const packed = { action: planned.action, input, result };
        toolResults.push(packed);
        sse(res, 'skill_result', { toolId, action: planned.action, result, toolMessage });
      } catch (error) {
        const toolMessage = await appendToolMessage(conversation, {
          action: planned.action,
          method: toolMethod(planned.action),
          status: 'error',
          summary: `工具失败: ${planned.action}`,
          input,
          error: { message: error.message },
          createdAt: nowIso()
        });
        const packed = { action: planned.action, input, error: error.message };
        toolResults.push(packed);
        sse(res, 'skill_error', { toolId, action: planned.action, error: error.message, toolMessage });
      }
    }

    if (toolResults.some((item) => item.action === 'ask-user' && item.result?.questions?.length)) {
      const assistantMessage = {
        id: id('msg'),
        role: 'assistant',
        content: '我先把需要确认的选项列出来了。你填完后，我会按你的选择继续组装任务或写卡。',
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
      return;
    }

    const messages = buildMessages({
      prompt,
      conversation: { ...conversation, messages: previousMessages },
      userText: req.body.message,
      section: req.body.section || '',
      developerRoleMode: store.data.settings.developerRoleMode || 'compat',
      selectedSkills: selectedSkillIds,
      skillCatalog: skills,
      toolResults
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

app.get('/api/queue', (req, res) => {
  res.json(cardQueue.snapshot());
});

app.post('/api/queue/tasks', async (req, res, next) => {
  try {
    const task = await cardQueue.createTask(req.body || {});
    res.json({ ok: true, task, queue: cardQueue.snapshot() });
  } catch (error) {
    next(error);
  }
});

app.put('/api/queue/tasks/:id', async (req, res, next) => {
  try {
    const task = await cardQueue.updateTask(req.params.id, req.body || {});
    if (!task) return res.status(404).json({ error: '队列任务不存在' });
    res.json({ ok: true, task, queue: cardQueue.snapshot() });
  } catch (error) {
    next(error);
  }
});

app.put('/api/queue/tasks/:taskId/items/:itemId', async (req, res, next) => {
  try {
    const task = await cardQueue.updateItem(req.params.taskId, req.params.itemId, req.body || {});
    if (!task) return res.status(404).json({ error: '队列条目不存在' });
    res.json({ ok: true, task, queue: cardQueue.snapshot() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/queue/run', async (req, res, next) => {
  try {
    cardQueue.resume(req.body?.taskId || '').catch((error) => console.error('queue run failed:', error));
    res.json({ ok: true, queue: cardQueue.snapshot() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/queue/pause', async (req, res, next) => {
  try {
    await cardQueue.pause();
    res.json({ ok: true, queue: cardQueue.snapshot() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/queue/resume', async (req, res, next) => {
  try {
    cardQueue.resume(req.body?.taskId || '').catch((error) => console.error('queue resume failed:', error));
    res.json({ ok: true, queue: cardQueue.snapshot() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/queue/cancel', async (req, res, next) => {
  try {
    await cardQueue.cancel(req.body?.taskId || '');
    res.json({ ok: true, queue: cardQueue.snapshot() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/queue/retry', async (req, res, next) => {
  try {
    cardQueue.retry(req.body?.taskId || '', req.body?.itemId || '').catch((error) => console.error('queue retry failed:', error));
    res.json({ ok: true, queue: cardQueue.snapshot() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/cards/preview', (req, res) => {
  const conversation = findConversation(req.body.conversationId);
  const markdown = req.body.markdown || latestAssistantMarkdown(conversation, req.body.messageId);
  res.json({ ...previewFromMarkdown(markdown), validation: validateCardMarkdown(markdown) });
});

app.post('/api/cards/validate', (req, res) => {
  const conversation = findConversation(req.body.conversationId);
  const markdown = req.body.markdown || latestAssistantMarkdown(conversation, req.body.messageId);
  res.json(validateCardMarkdown(markdown));
});

app.post('/api/cards/export', async (req, res, next) => {
  try {
    const conversation = findConversation(req.body.conversationId);
    const markdown = req.body.markdown || latestAssistantMarkdown(conversation, req.body.messageId);
    if (!markdown) return res.status(400).json({ error: '没有可导出的角色卡 Markdown' });
    const cardValidation = validateCardMarkdown(markdown);
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
    await recordWorkspaceCard(store.data.settings, {
      id: `${safeName}_${stamp}`,
      name: cardJson.name,
      source: 'manual',
      conversationId: conversation?.id || req.body.conversationId || '',
      json: path.basename(jsonPath),
      markdown: path.basename(mdPath),
      png: pngPath ? path.basename(pngPath) : '',
      validation: cardValidation
    });
    res.json({
      ok: true,
      name: cardJson.name,
      json: `/api/workspaces/file?name=${encodeURIComponent(path.basename(jsonPath))}`,
      markdown: `/api/workspaces/file?name=${encodeURIComponent(path.basename(mdPath))}`,
      png: pngPath ? `/api/workspaces/file?name=${encodeURIComponent(path.basename(pngPath))}` : null,
      workspace: workspace.name,
      preview: { ...previewFromMarkdown(markdown), validation: cardValidation },
      validation: cardValidation
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

app.get('/api/workspaces/index', async (req, res, next) => {
  try {
    res.json(await readWorkspaceIndex(store.data.settings));
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
    const input = normalizeActionInput(req.body.action, req.body, '');
    const { result, toolMessage } = await executeAgentAction(req.body.action, input, conversation);
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

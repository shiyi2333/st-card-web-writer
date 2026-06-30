import { id, nowIso } from './store.js';
import { DEFAULT_SKILLS, selectedSkillPrompt, skillCatalogPrompt } from './skills.js';

export const ROLE_OPTIONS = ['system', 'developer', 'user', 'assistant'];
export const PROMPT_BLOCK_TYPES = ['head', 'main', 'skill', 'userPrefix', 'historySlot', 'inputSlot', 'tail', 'normal'];

export const BLOCK_TYPE_LABELS = {
  head: '固定头部',
  main: '主提示词',
  skill: 'skill指导块',
  userPrefix: '用户输入前缀',
  historySlot: '对话历史占位',
  inputSlot: '用户输入占位',
  tail: '固定尾部',
  normal: '普通块'
};

export const CARD_SECTIONS = [
  '名称',
  '描述',
  '性格',
  '场景',
  '开场白',
  '作者备注',
  '标签',
  '绘图标签',
  '示例对话',
  '系统提示词',
  '备用开场白'
];

export const GENERAL_ASSISTANT_PROMPT = `你是一个通用助手，可以自然讨论各种主题，也可以在用户需要时协助完成写作、搜索、文件整理和 SillyTavern 角色卡制作。

默认情况下按普通对话回答，不要主动输出角色卡 Markdown，也不要擅自进入固定角色卡格式。
只有当用户明确要求写卡、改卡、搜图、导出、网页搜索或从界面选择了相关 skill 时，才使用对应 skill 的说明。
如果需要调用工具，先根据 skill 目录判断动作；工具结果会由系统提供，然后你再综合结果回复用户。`;

function block(input = {}, index = 0) {
  const type = PROMPT_BLOCK_TYPES.includes(input.type) ? input.type : 'normal';
  const locked = input.locked === true || ['historySlot', 'inputSlot'].includes(type);
  return {
    id: input.id || id('pb'),
    type,
    role: ROLE_OPTIONS.includes(input.role) ? input.role : 'system',
    title: input.title || BLOCK_TYPE_LABELS[type] || `提示词 ${index + 1}`,
    content: locked ? '' : String(input.content || ''),
    enabled: input.enabled !== false,
    locked,
    order: Number(input.order ?? (index + 1) * 10),
    identifier: input.identifier || ''
  };
}

export function makeDefaultPromptSet(createdAt = nowIso(), skills = DEFAULT_SKILLS) {
  const blocks = [
    block({ type: 'head', role: 'system', title: '通用助手规则', content: GENERAL_ASSISTANT_PROMPT, order: 10 }),
    block({ type: 'skill', role: 'developer', title: 'Skill 目录', content: skillCatalogPrompt(skills), order: 20, identifier: 'skillCatalog' }),
    block({ type: 'historySlot', role: 'system', title: '对话历史', order: 30 }),
    block({ type: 'inputSlot', role: 'user', title: '用户输入', order: 40 })
  ];

  return {
    id: id('prompt'),
    name: '通用助手',
    kind: 'generalAssistantV1',
    messages: blocks,
    createdAt,
    updatedAt: createdAt
  };
}

export function defaultStore(options = {}) {
  const createdAt = nowIso();
  const modelId = id('model');
  const prompt = makeDefaultPromptSet(createdAt);
  return {
    version: 4,
    settings: {
      workspaceRoot: options.workspaceRoot || 'G:\\角色卡',
      currentWorkspace: '一一',
      tavilyKey: '',
      agentApprovalMode: 'confirm',
      imageResultCount: 10,
      theme: 'system',
      developerRoleMode: 'compat',
      carouselTags: '1girl solo huge_breasts t-shirt'
    },
    usedImages: {
      global: [],
      workspaces: {}
    },
    imageCache: [],
    activeModelId: modelId,
    activePromptId: prompt.id,
    models: [
      {
        id: modelId,
        name: 'DeepSeek V4 Pro',
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        model: 'deepseek-v4-pro',
        temperature: 0.8,
        createdAt,
        updatedAt: createdAt
      }
    ],
    prompts: [prompt],
    conversations: []
  };
}

function migrateLegacyMessage(message = {}, index = 0) {
  const type = PROMPT_BLOCK_TYPES.includes(message.type)
    ? message.type
    : (message.title || '').includes('skill') || ((message.title || '').includes('规则') && message.role === 'developer')
      ? 'skill'
      : 'main';
  return block({
    ...message,
    type,
    locked: message.locked,
    order: Number(message.order ?? (index + 1) * 10)
  }, index);
}

export function normalizePrompt(prompt = {}) {
  const createdAt = prompt.createdAt || nowIso();
  let messages = Array.isArray(prompt.messages) && prompt.messages.length
    ? prompt.messages.map(migrateLegacyMessage)
    : [
        block({ type: 'main', role: 'system', title: '生成提示词', content: prompt.system || GENERAL_ASSISTANT_PROMPT, order: 10 })
      ];

  if (!messages.some((item) => item.type === 'historySlot')) {
    messages.push(block({ type: 'historySlot', title: '对话历史', order: 900 }));
  }
  if (!messages.some((item) => item.type === 'inputSlot')) {
    messages.push(block({ type: 'inputSlot', title: '用户输入', order: 910 }));
  }

  messages = messages
    .map((message, index) => block(message, index))
    .sort((a, b) => a.order - b.order)
    .map((message, index) => ({ ...message, order: (index + 1) * 10 }));

  return {
    id: prompt.id || id('prompt'),
    name: prompt.name || '角色卡预设',
    kind: prompt.kind || '',
    messages,
    createdAt,
    updatedAt: prompt.updatedAt || createdAt
  };
}

export function normalizePromptForSave(input = {}) {
  const createdAt = input.createdAt || nowIso();
  return normalizePrompt({
    ...input,
    createdAt,
    updatedAt: nowIso(),
    messages: Array.isArray(input.messages) ? input.messages : []
  });
}

export function ensurePromptSkillCatalog(prompt = {}, skills = DEFAULT_SKILLS) {
  const normalized = normalizePrompt(prompt);
  const catalog = skillCatalogPrompt(skills);
  const existing = normalized.messages.find((message) => message.identifier === 'skillCatalog' || message.title === 'Skill 目录');
  if (existing) {
    existing.content = catalog;
    existing.type = 'skill';
    existing.role = existing.role || 'developer';
    existing.identifier = 'skillCatalog';
    return normalizePrompt(normalized);
  }
  normalized.messages.push(block({
    type: 'skill',
    role: 'developer',
    title: 'Skill 目录',
    content: catalog,
    order: 25,
    identifier: 'skillCatalog'
  }));
  return normalizePrompt(normalized);
}

function mapRole(role, developerRoleMode = 'compat') {
  if (role === 'developer' && developerRoleMode !== 'native') return 'system';
  return role;
}

function messageFromBlock(blockItem, developerRoleMode) {
  return {
    role: mapRole(blockItem.role, developerRoleMode),
    content: blockItem.content
  };
}

export function buildMessages({
  prompt,
  conversation,
  userText,
  section = '',
  developerRoleMode = 'compat',
  selectedSkills = [],
  skillCatalog = DEFAULT_SKILLS,
  toolResults = []
}) {
  const normalized = normalizePrompt(prompt);
  const blocks = normalized.messages.filter((item) => item.enabled !== false);
  const history = (conversation?.messages || [])
    .filter((message) => ['user', 'assistant'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  const sectionPrefix = section ? `【目标区块：${section}】\n` : '';
  const skillPrefix = selectedSkillPrompt(selectedSkills, skillCatalog);
  const toolPrefix = toolResults.length
    ? `以下是本轮已执行 skill/tool 的结果，请基于这些结果回答：\n${JSON.stringify(toolResults, null, 2)}`
    : '';
  const output = [];
  let historyInserted = false;
  let inputInserted = false;
  let userPrefix = '';

  const insertHistory = () => {
    if (historyInserted) return;
    output.push(...history);
    historyInserted = true;
  };

  const insertInput = () => {
    if (inputInserted) return;
    output.push({
      role: 'user',
      content: [userPrefix, skillPrefix, toolPrefix, `${sectionPrefix}${userText}`].filter(Boolean).join('\n\n')
    });
    inputInserted = true;
  };

  for (const item of blocks) {
    if (item.type === 'historySlot') {
      insertHistory();
      continue;
    }
    if (item.type === 'inputSlot') {
      if (!historyInserted) insertHistory();
      insertInput();
      continue;
    }
    if (item.type === 'userPrefix') {
      if (item.content.trim()) userPrefix += `${userPrefix ? '\n\n' : ''}${item.content.trim()}`;
      continue;
    }
    if (item.content.trim()) output.push(messageFromBlock(item, developerRoleMode));
  }

  if (!historyInserted) insertHistory();
  if (!inputInserted) insertInput();
  return output;
}

function blockTypeForIdentifier(identifier = '', marker = false) {
  if (identifier === 'chatHistory') return 'historySlot';
  if (identifier === 'main') return 'main';
  if (identifier === 'jailbreak' || identifier === 'nsfw') return 'tail';
  if (identifier === 'dialogueExamples' || identifier === 'charDescription' || identifier === 'charPersonality' || identifier === 'scenario' || identifier === 'worldInfoBefore' || identifier === 'worldInfoAfter') return 'skill';
  if (marker) return 'normal';
  return 'normal';
}

export function importSillyTavernPreset(input = {}) {
  if (!Array.isArray(input.prompts)) {
    const error = new Error('不是 SillyTavern OpenAI preset：缺少 prompts 数组');
    error.status = 400;
    throw error;
  }

  const prompts = new Map(input.prompts.map((prompt) => [prompt.identifier || prompt.name, prompt]));
  const ordered = Array.isArray(input.prompt_order?.[0]?.order)
    ? input.prompt_order[0].order
    : input.prompts.map((prompt) => ({ identifier: prompt.identifier || prompt.name, enabled: true }));

  const blocks = [];
  const mapping = [];
  for (const item of ordered) {
    const source = prompts.get(item.identifier);
    const marker = source?.marker === true || source?.content === undefined;
    const type = blockTypeForIdentifier(item.identifier, marker);
    const title = source?.name || item.identifier || 'ST Prompt';
    blocks.push(block({
      type,
      role: ROLE_OPTIONS.includes(source?.role) ? source.role : 'system',
      title,
      content: marker ? '' : String(source?.content || ''),
      enabled: item.enabled !== false,
      locked: type === 'historySlot',
      identifier: item.identifier
    }, blocks.length));
    mapping.push({
      identifier: item.identifier,
      title,
      type,
      enabled: item.enabled !== false,
      marker
    });
  }

  if (!blocks.some((item) => item.type === 'inputSlot')) {
    blocks.push(block({ type: 'inputSlot', title: '用户输入', order: (blocks.length + 1) * 10 }, blocks.length));
    mapping.push({ identifier: 'inputSlot', title: '用户输入', type: 'inputSlot', enabled: true, marker: true });
  }

  const now = nowIso();
  const prompt = normalizePrompt({
    id: id('prompt'),
    name: input.name || input.preset_name || '导入的 ST 预设',
    kind: 'st-import',
    messages: blocks,
    createdAt: now,
    updatedAt: now
  });

  return { prompt, mapping };
}

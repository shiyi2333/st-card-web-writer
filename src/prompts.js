import { id, nowIso } from './store.js';
import { DEFAULT_SKILLS, selectedSkillPrompt, skillCatalogPrompt } from './skills.js';

export const ROLE_OPTIONS = ['system', 'developer', 'user', 'assistant'];
export const PROMPT_BLOCK_TYPES = ['head', 'main', 'skill', 'userPrefix', 'skillSlot', 'historySlot', 'historyInject', 'inputSlot', 'tail', 'normal'];

export const BLOCK_TYPE_LABELS = {
  head: '固定头部',
  main: '主提示词',
  skill: 'skill指导块',
  userPrefix: '用户输入前缀',
  skillSlot: '固定 Skill 文档',
  historySlot: '对话历史占位',
  historyInject: '历史深度插入',
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
固定 Skill 文档会在运行时提供可用能力目录；只有用户意图明确或用户手动选择 skill 时，才读取并应用对应 skill。`;

function block(input = {}, index = 0) {
  const type = PROMPT_BLOCK_TYPES.includes(input.type) ? input.type : 'normal';
  const locked = input.locked === true || ['historySlot', 'inputSlot', 'skillSlot'].includes(type);
  const hasInjectionDepth = input.injectionDepth !== undefined && input.injectionDepth !== null && input.injectionDepth !== '';
  const hasInjectionOrder = input.injectionOrder !== undefined && input.injectionOrder !== null && input.injectionOrder !== '';
  return {
    id: input.id || id('pb'),
    type,
    role: ROLE_OPTIONS.includes(input.role) ? input.role : 'system',
    title: input.title || BLOCK_TYPE_LABELS[type] || `提示词 ${index + 1}`,
    content: locked ? '' : String(input.content || ''),
    enabled: input.enabled !== false,
    locked,
    order: Number(input.order ?? (index + 1) * 10),
    identifier: input.identifier || '',
    injectionDepth: hasInjectionDepth && Number.isFinite(Number(input.injectionDepth)) ? Math.max(0, Number(input.injectionDepth)) : null,
    injectionPosition: input.injectionPosition ?? '',
    injectionOrder: hasInjectionOrder && Number.isFinite(Number(input.injectionOrder)) ? Number(input.injectionOrder) : null,
    injectionTrigger: Array.isArray(input.injectionTrigger) ? input.injectionTrigger.map(String) : [],
    forbidOverrides: input.forbidOverrides === true,
    systemPrompt: input.systemPrompt === true,
    marker: input.marker === true,
    characterId: input.characterId ?? null
  };
}

function defaultGeneralBlocks() {
  return [
    block({ type: 'normal', role: 'system', title: '空开头', content: '', order: 10 }),
    block({ type: 'normal', role: 'system', title: '总简介提示词', content: GENERAL_ASSISTANT_PROMPT, order: 20 }),
    block({ type: 'skillSlot', role: 'developer', title: '固定 Skill 文档', order: 30 }),
    block({ type: 'historySlot', role: 'system', title: '对话历史', order: 40 }),
    block({ type: 'normal', role: 'system', title: '空结尾', content: '', order: 50 })
  ];
}

export function makeDefaultPromptSet(createdAt = nowIso(), skills = DEFAULT_SKILLS) {
  const blocks = defaultGeneralBlocks();
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
      carouselTags: '1girl solo huge_breasts t-shirt',
      thinkBlockRegex: '<Think>([\\s\\S]*?)</Think>',
      thinkBlockRegexFlags: 'gi'
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

function ensureRuntimeBlocks(messages = []) {
  const withoutDuplicateRuntime = [];
  let skillSlot = null;
  let historySlot = null;

  for (const message of messages) {
    if (message.type === 'skillSlot') {
      if (!skillSlot) skillSlot = message;
      continue;
    }
    if (message.type === 'historySlot') {
      if (!historySlot) historySlot = message;
      continue;
    }
    if (message.type === 'inputSlot') {
      continue;
    }
    withoutDuplicateRuntime.push(message);
  }

  const baseOrder = Math.max(900, ...withoutDuplicateRuntime.map((item) => Number(item.order) || 0)) + 10;
  const historyOrder = Number(historySlot?.order ?? (Number(skillSlot?.order ?? baseOrder) + 1));
  const skillOrder = Number(skillSlot?.order ?? historyOrder - 1);
  const runtimeBlocks = [
    block({
      ...skillSlot,
      type: 'skillSlot',
      role: 'developer',
      title: skillSlot?.title || '固定 Skill 文档',
      order: skillOrder,
      locked: true,
      content: ''
    })
  ];

  runtimeBlocks.push(block({
    ...historySlot,
    type: 'historySlot',
    role: historySlot?.role || 'system',
    title: historySlot?.title || '对话历史',
    order: historyOrder,
    locked: true,
    content: ''
  }));

  return [
    ...withoutDuplicateRuntime,
    ...runtimeBlocks
  ];
}

function migrateGeneralAssistantPrompt(prompt = {}, messages = []) {
  if (prompt.kind !== 'generalAssistantV1') return messages;
  const migrated = messages
    .filter((message) => message.type !== 'inputSlot')
    .map((message) => {
      if ((message.type === 'head' || message.type === 'normal') && (message.title === '通用助手规则' || message.content.includes('通用助手'))) {
        return block({ ...message, type: 'normal', title: '空开头', content: '', order: 10 });
      }
      return message;
    });
  if (!migrated.some((message) => message.title === '空开头')) {
    migrated.unshift(block({ type: 'normal', role: 'system', title: '空开头', content: '', order: 10 }));
  }
  if (!migrated.some((message) => message.title === '总简介提示词')) {
    const headOrder = migrated.find((message) => message.title === '空开头')?.order ?? 10;
    migrated.push(block({ type: 'normal', role: 'system', title: '总简介提示词', content: GENERAL_ASSISTANT_PROMPT, order: headOrder + 1 }));
  }
  if (!migrated.some((message) => message.title === '空结尾')) {
    migrated.push(block({ type: 'normal', role: 'system', title: '空结尾', content: '', order: 999 }));
  }
  return migrated;
}

export function normalizePrompt(prompt = {}) {
  const createdAt = prompt.createdAt || nowIso();
  let messages = Array.isArray(prompt.messages) && prompt.messages.length
    ? prompt.messages.map(migrateLegacyMessage)
    : defaultGeneralBlocks();

  messages = migrateGeneralAssistantPrompt(prompt, messages);
  messages = ensureRuntimeBlocks(messages);

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
  normalized.messages = normalized.messages.filter((message) => message.identifier !== 'skillCatalog' && message.title !== 'Skill 目录');
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
  const blocks = normalized.messages.filter((item) => item.enabled !== false && item.identifier !== 'skillCatalog' && item.title !== 'Skill 目录');
  const historyInjectBlocks = blocks
    .filter((item) => item.type === 'historyInject' && item.content.trim())
    .sort((a, b) => {
      const aDepth = Number.isFinite(Number(a.injectionDepth)) ? Number(a.injectionDepth) : 0;
      const bDepth = Number.isFinite(Number(b.injectionDepth)) ? Number(b.injectionDepth) : 0;
      return bDepth - aDepth || a.order - b.order;
    });
  const history = (conversation?.messages || [])
    .filter((message) => ['user', 'assistant'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  const sectionPrefix = section ? `【目标区块：${section}】\n` : '';
  const fixedToolPrompt = skillCatalogPrompt(skillCatalog);
  const skillPrefix = selectedSkillPrompt(selectedSkills, skillCatalog);
  const toolPrefix = toolResults.length
    ? `以下是本轮已执行 skill/tool 的结果，请基于这些结果回答：\n${JSON.stringify(toolResults, null, 2)}`
    : '';
  const output = [];
  let historyInserted = false;
  let skillDocsInserted = false;
  let userPrefix = '';

  const currentUserMessage = () => ({
    role: 'user',
    content: [userPrefix, skillPrefix, toolPrefix, `${sectionPrefix}${userText}`].filter(Boolean).join('\n\n')
  });

  const historyWithDepthInjections = () => {
    const merged = [...history, currentUserMessage()];
    for (const item of historyInjectBlocks) {
      const depth = Number.isFinite(Number(item.injectionDepth)) ? Math.max(0, Number(item.injectionDepth)) : 0;
      const insertAt = Math.max(0, merged.length - depth);
      merged.splice(insertAt, 0, messageFromBlock(item, developerRoleMode));
    }
    return merged;
  };

  const insertSkillDocs = () => {
    if (skillDocsInserted) return;
    output.push({
      role: mapRole('developer', developerRoleMode),
      content: fixedToolPrompt
    });
    skillDocsInserted = true;
  };

  const insertHistory = () => {
    if (historyInserted) return;
    output.push(...historyWithDepthInjections());
    historyInserted = true;
  };

  for (const item of blocks) {
    if (item.type === 'skillSlot') {
      insertSkillDocs();
      continue;
    }
    if (item.type === 'historySlot') {
      insertHistory();
      continue;
    }
    if (item.type === 'historyInject') {
      continue;
    }
    if (item.type === 'inputSlot') {
      insertHistory();
      continue;
    }
    if (item.type === 'userPrefix') {
      if (item.content.trim()) userPrefix += `${userPrefix ? '\n\n' : ''}${item.content.trim()}`;
      continue;
    }
    if (item.content.trim()) output.push(messageFromBlock(item, developerRoleMode));
  }

  if (!skillDocsInserted) insertSkillDocs();
  if (!historyInserted) insertHistory();
  return output;
}

function promptContent(source = {}) {
  for (const key of ['content', 'prompt', 'value', 'text']) {
    if (source?.[key] !== undefined && source?.[key] !== null && String(source[key]).length) return String(source[key]);
  }
  if (typeof source?.system_prompt === 'string' && source.system_prompt.length) return String(source.system_prompt);
  return '';
}

function promptMarker(source = {}) {
  return source?.marker === true || !promptContent(source).trim();
}

function promptInjectionMeta(source = {}, orderItem = {}) {
  const depth = source?.injection_depth ?? source?.injectionDepth ?? source?.depth ?? orderItem?.injection_depth ?? orderItem?.injectionDepth ?? orderItem?.depth;
  const position = source?.injection_position ?? source?.injectionPosition ?? source?.position ?? orderItem?.injection_position ?? orderItem?.injectionPosition ?? orderItem?.position ?? '';
  const hasDepth = depth !== undefined && depth !== null && depth !== '';
  const hasPosition = position !== undefined && position !== null && String(position).trim() !== '';
  return {
    isInjected: hasDepth || hasPosition,
    depth: hasDepth ? Math.max(0, Number(depth) || 0) : 0,
    position: String(position || '')
  };
}

function isCustomDepthPrompt(source = {}, injection = {}) {
  if (!injection.isInjected) return false;
  if (source?.system_prompt === false) return true;
  return false;
}

function blockTypeForIdentifier(identifier = '', marker = false, injection = {}, source = {}) {
  if (identifier === 'chatHistory') return 'historySlot';
  if (!marker && isCustomDepthPrompt(source, injection)) return 'historyInject';
  return 'normal';
}

export function importSillyTavernPreset(input = {}) {
  if (!Array.isArray(input.prompts)) {
    const error = new Error('不是 SillyTavern OpenAI preset：缺少 prompts 数组');
    error.status = 400;
    throw error;
  }

  const prompts = new Map();
  for (const prompt of input.prompts) {
    for (const key of [prompt.identifier, prompt.name, prompt.id].filter(Boolean)) {
      prompts.set(key, prompt);
    }
  }
  const now = nowIso();
  const orderGroups = Array.isArray(input.prompt_order) && input.prompt_order.some((group) => Array.isArray(group.order))
    ? input.prompt_order
    : [{ character_id: null, order: input.prompts.map((prompt) => ({ identifier: prompt.identifier || prompt.name, enabled: prompt.enabled !== false })) }];
  const baseName = input.name || input.preset_name || input.presetName || '导入的 ST 预设';

  const imported = orderGroups.map((group, groupIndex) => {
    const ordered = Array.isArray(group.order) ? group.order : [];
    const characterId = group.character_id ?? group.characterId ?? null;
    const blocks = [];
    const mapping = [];
    let sawChatHistory = false;

    for (const item of ordered) {
      const identifier = item.identifier || item.name;
      if (!identifier) continue;
      const source = prompts.get(identifier) || {};
      const marker = promptMarker(source);
      const injection = promptInjectionMeta(source, item);
      const type = blockTypeForIdentifier(identifier, marker, injection, source);
      if (type === 'historySlot') {
        sawChatHistory = true;
        mapping.push({
          identifier,
          title: source?.name || identifier || 'ST Prompt',
          type: 'skippedChatHistory',
          role: 'system',
          enabled: item.enabled !== false && source.enabled !== false,
          marker: true,
          characterId,
          order: blocks.length,
          injectionDepth: null,
          injectionPosition: '',
          injectionOrder: null,
          injectionTrigger: [],
          skipped: true
        });
        continue;
      }
      const title = source?.name || identifier || 'ST Prompt';
      const injectionOrder = source?.injection_order ?? source?.injectionOrder ?? item?.injection_order ?? item?.injectionOrder ?? null;
      const injectionTrigger = source?.injection_trigger ?? source?.injectionTrigger ?? item?.injection_trigger ?? item?.injectionTrigger ?? [];
      const enabled = item.enabled !== false && source.enabled !== false;

      blocks.push(block({
        type,
        role: ROLE_OPTIONS.includes(source?.role) ? source.role : 'system',
        title,
        content: marker ? '' : promptContent(source),
        enabled,
        locked: type === 'historySlot',
        identifier,
        injectionDepth: injection.isInjected ? injection.depth : null,
        injectionPosition: injection.isInjected ? injection.position : '',
        injectionOrder,
        injectionTrigger: Array.isArray(injectionTrigger) ? injectionTrigger : [],
        forbidOverrides: source?.forbid_overrides === true || source?.forbidOverrides === true,
        systemPrompt: source?.system_prompt === true,
        marker,
        characterId
      }, blocks.length));
      mapping.push({
        identifier,
        title,
        type,
        role: ROLE_OPTIONS.includes(source?.role) ? source.role : 'system',
        enabled,
        marker,
        characterId,
        order: blocks.length,
        injectionDepth: injection.isInjected ? injection.depth : null,
        injectionPosition: injection.isInjected ? injection.position : '',
        injectionOrder: injectionOrder === null ? null : Number(injectionOrder),
        injectionTrigger: Array.isArray(injectionTrigger) ? injectionTrigger : [],
        forbidOverrides: source?.forbid_overrides === true || source?.forbidOverrides === true,
        systemPrompt: source?.system_prompt === true
      });
    }

    if (sawChatHistory) {
      blocks.push(block({
        type: 'historySlot',
        role: 'system',
        title: '对话历史',
        locked: true,
        characterId,
        order: (blocks.length + 1) * 10
      }, blocks.length));
    }

    const suffix = characterId !== null && characterId !== undefined ? ` / character ${characterId}` : (orderGroups.length > 1 ? ` / order ${groupIndex + 1}` : '');
    const prompt = normalizePrompt({
      id: id('prompt'),
      name: `${baseName}${suffix}`,
      kind: 'st-import',
      messages: blocks,
      createdAt: now,
      updatedAt: now
    });

    return { prompt, mapping, characterId };
  });

  const resultPrompts = imported.map((item) => item.prompt);
  const resultMappings = imported.map((item) => ({ promptId: item.prompt.id, name: item.prompt.name, characterId: item.characterId, mapping: item.mapping }));
  const activeIndex = resultPrompts.reduce((bestIndex, prompt, index) => {
    const best = resultPrompts[bestIndex];
    const score = prompt.messages.filter((item) => item.type !== 'skillSlot' && item.type !== 'historySlot' && item.type !== 'inputSlot').length;
    const bestScore = best.messages.filter((item) => item.type !== 'skillSlot' && item.type !== 'historySlot' && item.type !== 'inputSlot').length;
    return score >= bestScore ? index : bestIndex;
  }, 0);
  return {
    prompt: resultPrompts[activeIndex],
    prompts: resultPrompts,
    mapping: imported[activeIndex]?.mapping || [],
    mappings: resultMappings
  };
}

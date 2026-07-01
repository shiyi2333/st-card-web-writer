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
工具使用说明会由系统在运行时固定提供。`;

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

export function makeDefaultPromptSet(createdAt = nowIso(), skills = DEFAULT_SKILLS) {
  const blocks = [
    block({ type: 'head', role: 'system', title: '通用助手规则', content: GENERAL_ASSISTANT_PROMPT, order: 10 }),
    block({ type: 'skillSlot', role: 'developer', title: '固定 Skill 文档', order: 20 }),
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
  if (!messages.some((item) => item.type === 'skillSlot')) {
    const historyOrder = messages.find((item) => item.type === 'historySlot')?.order ?? 900;
    messages.push(block({ type: 'skillSlot', role: 'developer', title: '固定 Skill 文档', order: historyOrder - 1 }));
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
  let inputInserted = false;
  let skillDocsInserted = false;
  let userPrefix = '';

  const historyWithDepthInjections = () => {
    const merged = [...history];
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

  const insertInput = () => {
    if (inputInserted) return;
    output.push({
      role: 'user',
      content: [userPrefix, skillPrefix, toolPrefix, `${sectionPrefix}${userText}`].filter(Boolean).join('\n\n')
    });
    inputInserted = true;
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

  if (!skillDocsInserted) insertSkillDocs();
  if (!historyInserted) insertHistory();
  if (!inputInserted) insertInput();
  return output;
}

function promptContent(source = {}) {
  if (source?.content !== undefined) return String(source.content || '');
  if (typeof source?.system_prompt === 'string') return String(source.system_prompt || '');
  return '';
}

function promptMarker(source = {}) {
  return source?.marker === true || (source?.content === undefined && typeof source?.system_prompt !== 'string');
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
  if (identifier === 'main') return 'main';
  if (identifier === 'jailbreak' || identifier === 'nsfw') return 'tail';
  if (identifier === 'dialogueExamples' || identifier === 'charDescription' || identifier === 'charPersonality' || identifier === 'scenario' || identifier === 'worldInfoBefore' || identifier === 'worldInfoAfter') return 'skill';
  if (!marker && isCustomDepthPrompt(source, injection)) return 'historyInject';
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

    for (const item of ordered) {
      const identifier = item.identifier || item.name;
      if (!identifier) continue;
      const source = prompts.get(identifier) || {};
      const marker = promptMarker(source);
      const injection = promptInjectionMeta(source, item);
      const type = blockTypeForIdentifier(identifier, marker, injection, source);
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

    if (!blocks.some((item) => item.type === 'inputSlot')) {
      blocks.push(block({ type: 'inputSlot', title: '用户输入', order: (blocks.length + 1) * 10, characterId }, blocks.length));
      mapping.push({ identifier: 'inputSlot', title: '用户输入', type: 'inputSlot', role: 'user', enabled: true, marker: true, characterId, order: blocks.length, injectionDepth: null, injectionPosition: '', injectionOrder: null, injectionTrigger: [] });
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
  const resultMappings = imported.map((item) => ({ characterId: item.characterId, mapping: item.mapping }));
  return {
    prompt: resultPrompts[0],
    prompts: resultPrompts,
    mapping: imported[0]?.mapping || [],
    mappings: resultMappings
  };
}

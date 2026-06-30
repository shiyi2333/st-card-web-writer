import { id, nowIso } from './store.js';
import { selectedSkillPrompt, skillCatalogPrompt } from './skills.js';

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

export const LOBSTER_CARD_PROMPT = `你是 SillyTavern 角色卡写卡器。根据用户需求生成 Tavern Card V2 角色卡内容，直接输出 Markdown，不要解释，不要包裹代码块。

必须使用这些一级标题，标题名保持中文：
# 名称
# 描述
# 性格
# 场景
# 开场白
# 作者备注
# 标签
# 绘图标签

可选标题：
# 示例对话
# 系统提示词
# 备用开场白

写卡规则：
- 所有成人向内容必须是明确成年人、同意语境；不要写未成年、学校年龄段、胁迫或非自愿框架。
- 名称用轻小说或网文风格命名角色卡，不要只写角色真名。
- 描述必须是 fenced yaml 块，至少包含 identity、appearance、primary_attributes。外表要明确记录发色、体型、胸部规模、常用服装、主要属性。
- 开场白是一条完整 first message，默认 300-500 个汉字，至少三段自然段，段落之间空行。不要写成一团。
- 默认不要状态栏。只有用户明确要求状态栏时才加入 description.status_bar 和系统提示词里的状态栏规则。默认状态栏字段固定为：【乳头】【情绪】【服饰】【阴道精液量】。
- 状态栏不要重复复制；只在每次回复末尾追加一次。如果开场白里需要展示初始状态栏，也只展示一个具体状态栏。
- 行文采用轻网文式的自然叙事节奏，人物的语言、动作和神态要彼此衔接，不要让对话悬空。每句台词前后都适当安排人物的视线、表情、手部动作、停顿、姿态变化或心理反应，使动作像是从对话中自然长出来，而不是生硬插入。
- 不要刻意制造吐槽感，不要频繁使用单字、单词或单独成段的短句修饰气氛。避免大量使用没有人物名或人称代词开头的动作句，不要让句子碎片化、悬浮化。描写应当流畅自然、充盈丰满。
- 作者备注是给玩家看的角色卡简介，不是图片来源。不要 Markdown 列表。通常 6-12 个短段落，可以从开场白的一部分气氛中延展，用“你”作为玩家视角，使用轻小说/网文式引导，包含 2-4 段中文引号台词，说明故事钩子、角色欲望、压力、害怕、误会、后悔或可能失去的东西，并用疑问或未解悬念收尾。
- 标签是 ST 检索标签，3-10 个，推荐 5-8 个。只写卡内设定能推出的标签，不要混入 1girl、solo、t-shirt 这类绘图标签。
- 绘图标签是 Danbooru 英文 tags，6-12 个。通常包含 1girl/1boy、solo、original，优先发色和常见服装；服装不明确时用 t-shirt。可以使用宽松成人向标签和常见属性保底，例如 mesugaki、huge breasts、nsfw、cleavage、shirt lift，但禁止 loli、shota、young、child、underage。

如果用户要求单独修改某个部分，仍然输出完整 Markdown 角色卡，不要只输出片段。`;

export const SECTION_REWRITE_PROMPT = `你是 SillyTavern 角色卡编辑器。用户会指定一个目标区块和修改要求。请保持其余章节不丢失，把目标区块重写得更好，并输出完整 Markdown 角色卡。

修改原则：
- 只强化用户指定的区块，除非为了保持上下文一致必须微调其他区块。
- 保持中文一级标题结构：名称、描述、性格、场景、开场白、作者备注、标签、绘图标签。
- 作者备注要是轻小说/网文式玩家导语，不要写图片来源，不要 Markdown。
- tag 最多十个，绘图标签和 ST 标签不要混在一起。
- 默认不要状态栏；用户明确要求时才加入一次状态栏规则，避免重复复制。`;

export const WEB_SEARCH_PROMPT = `当用户需要联网资料时，可以调用 Tavily 网页搜索工具。使用搜索结果时要优先摘要网页事实，给出来源链接，不要编造未出现在结果里的信息。`;

export const IMAGE_SEARCH_PROMPT = `当用户需要角色卡配图时，可以调用 Danbooru 搜图工具。优先使用角色外貌里的发色、体型和常用服装；服装不明确时用 t-shirt。一次搜索 5 或 10 张，由用户选择。避免重复使用已经用过的 post id。`;

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

export function makeDefaultPromptSet(createdAt = nowIso()) {
  const blocks = [
    block({ type: 'head', role: 'system', title: '输出格式头部', content: '你正在生成 SillyTavern 角色卡。除 Markdown 角色卡正文外，不要输出解释、寒暄或 JSON。', order: 10 }),
    block({ type: 'main', role: 'system', title: '龙虾写卡主规则', content: LOBSTER_CARD_PROMPT, order: 20 }),
    block({ type: 'skill', role: 'developer', title: 'Skill 目录', content: skillCatalogPrompt(), order: 30, identifier: 'skillCatalog' }),
    block({ type: 'skill', role: 'developer', title: '单区块重写 skill', content: SECTION_REWRITE_PROMPT, order: 40 }),
    block({ type: 'skill', role: 'developer', title: '搜图 skill', content: IMAGE_SEARCH_PROMPT, order: 50 }),
    block({ type: 'skill', role: 'developer', title: '网页搜索 skill', content: WEB_SEARCH_PROMPT, order: 60 }),
    block({ type: 'historySlot', role: 'system', title: '对话历史', order: 70 }),
    block({ type: 'userPrefix', role: 'user', title: '本次请求前缀', content: '请根据下面这次用户请求继续写卡或改卡。', order: 80 }),
    block({ type: 'inputSlot', role: 'user', title: '用户输入', order: 90 }),
    block({ type: 'tail', role: 'system', title: '固定尾部', content: '最后再次检查：标题完整、作者备注不是图片来源、标签不超过十个、默认不要状态栏。', order: 100 })
  ];

  return {
    id: id('prompt'),
    name: '龙虾写卡',
    kind: 'lobsterCardV3',
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
    version: 3,
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

export function ensurePromptSkillCatalog(prompt = {}) {
  const normalized = normalizePrompt(prompt);
  if (normalized.messages.some((message) => message.identifier === 'skillCatalog' || message.title === 'Skill 目录')) {
    return normalized;
  }
  normalized.messages.push(block({
    type: 'skill',
    role: 'developer',
    title: 'Skill 目录',
    content: skillCatalogPrompt(),
    order: 25,
    identifier: 'skillCatalog'
  }));
  return normalizePrompt(normalized);
}

function migrateLegacyMessage(message = {}, index = 0) {
  const type = PROMPT_BLOCK_TYPES.includes(message.type)
    ? message.type
    : (message.title || '').includes('skill') || (message.title || '').includes('规则') && message.role === 'developer'
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
        block({ type: 'main', role: 'system', title: '生成提示词', content: prompt.system || LOBSTER_CARD_PROMPT, order: 10 }),
        block({ type: 'skill', role: 'developer', title: '单区块修改提示词', content: prompt.rewrite || SECTION_REWRITE_PROMPT, order: 20 })
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

export function buildMessages({ prompt, conversation, userText, section = '', developerRoleMode = 'compat', selectedSkills = [] }) {
  const normalized = normalizePrompt(prompt);
  const blocks = normalized.messages.filter((item) => item.enabled !== false);
  const history = (conversation?.messages || [])
    .filter((message) => ['user', 'assistant'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  const sectionPrefix = section ? `【目标区块：${section}】\n` : '';
  const skillPrefix = selectedSkillPrompt(selectedSkills);
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
      content: [userPrefix, skillPrefix, `${sectionPrefix}${userText}`].filter(Boolean).join('\n\n')
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

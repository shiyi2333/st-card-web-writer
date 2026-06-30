const SECTION_NAMES = [
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

const ALIASES = new Map([
  ['名字', '名称'],
  ['角色名', '名称'],
  ['角色名称', '名称'],
  ['角色描述', '描述'],
  ['设定', '描述'],
  ['人物设定', '描述'],
  ['情景', '场景'],
  ['首条消息', '开场白'],
  ['第一条消息', '开场白'],
  ['初始消息', '开场白'],
  ['创作者备注', '作者备注'],
  ['备注', '作者备注'],
  ['制作备注', '作者备注'],
  ['配图标签', '绘图标签'],
  ['系统提示', '系统提示词']
]);

function cleanHeading(value) {
  const name = String(value || '').replace(/[：:(（].*$/, '').trim();
  return ALIASES.get(name) || name;
}

export function parseMarkdownCard(markdown = '') {
  const sections = {};
  const headingPattern = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  for (let i = 0; i < matches.length; i += 1) {
    const heading = cleanHeading(matches[i][1]);
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    if (SECTION_NAMES.includes(heading)) {
      sections[heading] = markdown.slice(start, end).trim();
    }
  }
  return sections;
}

export function markdownFromSections(sections) {
  return SECTION_NAMES
    .filter((name) => sections[name])
    .map((name) => `# ${name}\n${sections[name].trim()}`)
    .join('\n\n');
}

export function listFromSection(value = '', drawing = false) {
  const pattern = drawing ? /[,，\s\n]+/ : /[,，、\n]+/;
  return String(value)
    .split(pattern)
    .map((item) => item.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean);
}

export function stripFence(value = '') {
  const trimmed = String(value).trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : trimmed;
}

export function makeCardJson(markdown, options = {}) {
  const sections = parseMarkdownCard(markdown);
  const name = options.name || sections['名称'] || '未命名角色卡';
  const creatorNotes = sections['作者备注'] || '';
  const tags = listFromSection(sections['标签'] || '').slice(0, 10);
  const drawingTags = listFromSection(sections['绘图标签'] || '', true);
  const systemPrompt = sections['系统提示词'] || '';
  const worldName = options.world || `${name}_文风规则`;
  const now = new Date();
  const createDate = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} @${String(now.getHours()).padStart(2, '0')}h ${String(now.getMinutes()).padStart(2, '0')}m ${String(now.getSeconds()).padStart(2, '0')}s ${String(now.getMilliseconds()).padStart(3, '0')}ms`;

  return {
    name,
    description: stripFence(sections['描述'] || ''),
    personality: sections['性格'] || '',
    scenario: sections['场景'] || '',
    first_mes: sections['开场白'] || '',
    mes_example: sections['示例对话'] || '',
    creatorcomment: creatorNotes,
    avatar: 'none',
    chat: `${name} - ${createDate}`,
    talkativeness: '0.5',
    fav: false,
    spec: 'chara_card_v2',
    spec_version: '2.0',
    tags,
    data: {
      name,
      description: stripFence(sections['描述'] || ''),
      personality: sections['性格'] || '',
      scenario: sections['场景'] || '',
      first_mes: sections['开场白'] || '',
      mes_example: sections['示例对话'] || '',
      creator_notes: creatorNotes,
      system_prompt: systemPrompt,
      post_history_instructions: '',
      tags,
      creator: options.creator || '',
      character_version: options.version || '',
      alternate_greetings: [],
      extensions: {
        talkativeness: '0.5',
        fav: false,
        world: worldName,
        danbooru_tags: drawingTags,
        depth_prompt: {
          prompt: '',
          depth: 4,
          role: 'system'
        }
      },
      character_book: {
        name: worldName,
        entries: []
      }
    }
  };
}

export function previewFromMarkdown(markdown = '') {
  const sections = parseMarkdownCard(markdown);
  const json = makeCardJson(markdown);
  return {
    sections,
    json,
    stats: {
      title: json.name,
      tagCount: json.data.tags.length,
      drawingTagCount: json.data.extensions.danbooru_tags.length,
      openingChars: (sections['开场白']?.match(/[\u3400-\u9fff]/g) || []).length,
      hasStatusBar: /status_bar\s*:|状态栏|【[^】]+】/.test(`${sections['描述'] || ''}\n${sections['系统提示词'] || ''}`)
    }
  };
}

export function latestAssistantMarkdown(conversation, messageId) {
  if (!conversation) return '';
  if (messageId) {
    return conversation.messages.find((message) => message.id === messageId)?.content || '';
  }
  return [...conversation.messages].reverse().find((message) => message.role === 'assistant')?.content || '';
}

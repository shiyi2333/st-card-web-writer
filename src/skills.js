import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const skillDir = path.join(rootDir, 'skills');

export const DEFAULT_SKILLS = [
  {
    id: 'character-card-writer',
    name: '角色卡制作',
    category: '写卡',
    description: '当用户明确要创建、改写、整理或导出 SillyTavern 角色卡时使用。',
    actions: ['card-section-rewrite', 'image-search', 'export-card'],
    prompt: '你是 SillyTavern 角色卡写卡器。只有用户明确要写卡、改卡、预览卡或导出卡时才进入角色卡模式；普通聊天不要擅自输出角色卡。'
  },
  {
    id: 'card-section-rewrite',
    name: '单区块重写',
    category: '写卡',
    description: '当用户点击预览区块或明确要求只修某一部分时使用。',
    actions: ['card-section-rewrite'],
    prompt: '只重写用户指定的角色卡区块。除非上下文一致性必须调整，否则不要大幅改动其他区块；最终仍输出完整 Markdown 角色卡。'
  },
  {
    id: 'st-card-style-guide',
    name: 'ST 角色卡文风指南',
    category: '写卡',
    description: '写作、改写或检查 SillyTavern 角色卡时使用的文风和结构指南。',
    actions: [],
    prompt: '只在用户明确写卡、改卡、检查或导出 ST 角色卡时使用。开场白用“你”代指用户，角色部分用第三人称、角色姓名或自然代称；写具体可扮演的材料，不写空泛简介。'
  },
  {
    id: 'image-search',
    name: 'Danbooru 搜图',
    category: '工具',
    description: '当用户需要给角色卡配图、换图、继续找图时使用。',
    actions: ['image-search'],
    prompt: '根据角色外貌和用户要求整理 Danbooru tags。优先发色、t-shirt 等常见服装、huge_breasts 等稳定属性；一次建议 5 或 10 张候选，避免重复 post id。'
  },
  {
    id: 'web-search',
    name: '网页搜索',
    category: '工具',
    description: '当用户需要实时资料、网页来源、设定考据或外部信息时使用 Tavily 搜索。',
    actions: ['web-search'],
    prompt: '当问题依赖最新网页资料或明确要求搜索时，调用网页搜索；回答时基于搜索结果，不编造未出现的网页内容。'
  },
  {
    id: 'export-card',
    name: '导出 PNG/JSON',
    category: '工具',
    description: '当用户确认当前卡片可落盘、需要导出 ST PNG/JSON/Markdown 时使用。',
    actions: ['export-card'],
    prompt: '导出前检查角色卡章节完整、已选择图片或用户接受无图导出；导出到当前工作区。'
  },
  {
    id: 'workspace-manage',
    name: '工作区管理',
    category: '工具',
    description: '当用户要新建、切换、整理、下载、删除或移动工作区文件时使用。',
    actions: ['workspace-write'],
    prompt: '对删除、覆盖、移动等危险动作先确认；正式卡片产物和 temp 临时素材分开管理。'
  },
  {
    id: 'openclaw-erotic-style',
    name: 'OpenClaw 肉感文风',
    category: '文风',
    description: '用于成人角色卡的作者备注、开场白和场景氛围增强，是 agent 可选的风格 skill。',
    actions: [],
    prompt: '只用于明确成年且自愿的角色。写作者备注和开场白时，保持轻网文自然叙事，让语言、动作、神态、心理连续推进；用细腻感官、暧昧试探、欲望与后悔感制造张力。'
  }
];

let skillCache = null;

function parseFrontmatter(markdown = '') {
  const match = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: String(markdown).trim() };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    const [, key, rawValue] = item;
    const value = rawValue.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean);
    } else {
      meta[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: match[2].trim() };
}

function normalizeSkill(input = {}) {
  return {
    id: String(input.id || '').trim(),
    name: String(input.name || input.id || '').trim(),
    category: String(input.category || '通用').trim(),
    description: String(input.description || '').trim(),
    actions: Array.isArray(input.actions)
      ? input.actions.map(String).map((item) => item.trim()).filter(Boolean)
      : [],
    prompt: String(input.prompt || '').trim()
  };
}

async function readMarkdownSkills() {
  const entries = await fs.readdir(skillDir, { withFileTypes: true }).catch(() => []);
  const skills = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const source = await fs.readFile(path.join(skillDir, entry.name), 'utf8');
    const { meta, body } = parseFrontmatter(source);
    const skill = normalizeSkill({ ...meta, prompt: body });
    if (skill.category === '世界书') continue;
    if (skill.id) skills.push(skill);
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export async function readSkillCatalog({ refresh = false } = {}) {
  if (!refresh && skillCache) return skillCache;
  const skills = await readMarkdownSkills();
  skillCache = skills.length ? skills : DEFAULT_SKILLS;
  return skillCache;
}

export function skillCatalogPrompt(skills = DEFAULT_SKILLS) {
  return [
    '固定 Skill 文档：以下内容由项目 skills/*.md 自动组合而成，用于说明 agent 可调用的能力、写作规范和工具边界。',
    '根据用户意图判断是否需要使用某个 skill；只有真正有帮助时才使用，不要为了使用而使用。',
    '如果用户从界面显式选择了某个 skill，本轮优先遵循该 skill。普通聊天不要擅自进入角色卡制作格式。',
    '',
    ...skills.map((skill) => [
      `## ${skill.name} (${skill.id})`,
      `category: ${skill.category}`,
      `actions: ${(skill.actions || []).join(', ') || 'none'}`,
      `description: ${skill.description}`,
      '',
      skill.prompt
    ].join('\n'))
  ].join('\n');
}

export function selectedSkillPrompt(selected = [], skills = DEFAULT_SKILLS) {
  const ids = new Set((Array.isArray(selected) ? selected : []).map(String));
  const selectedSkills = skills.filter((skill) => ids.has(skill.id));
  if (!selectedSkills.length) return '';
  return [
    '本轮用户从 skill 列表中选择了以下 skill，请优先按这些 skill 的说明处理：',
    '',
    ...selectedSkills.map((skill) => `【${skill.name}】${skill.prompt}`)
  ].join('\n');
}

export function skillByAction(action, skills = DEFAULT_SKILLS) {
  return skills.find((skill) => skill.actions?.includes(action));
}

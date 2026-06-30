import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const defaultWorldbookPath = path.join(rootDir, 'skills', 'default-style-worldbook.md');

function stripFrontmatter(markdown = '') {
  return String(markdown).replace(/^---\s*[\s\S]*?\s*---\s*/, '').trim();
}

function readDefaultStyleWorldEntry() {
  try {
    const markdown = fs.readFileSync(defaultWorldbookPath, 'utf8');
    const body = stripFrontmatter(markdown);
    if (body) return body;
  } catch {
    // Fall back to the embedded copy below when the skill file is missing.
  }

  return `行文采用轻网文式的自然叙事节奏。人物语言、动作和神态要彼此衔接，不要让对话悬空。

每句台词前后都适当安排人物的视线、表情、手部动作、停顿、姿态变化或心理反应，使动作像是从对话中自然长出来，而不是生硬插入。

不要刻意制造吐槽感，不要频繁使用单字、单词或单独成段的短句来修饰气氛。避免大量使用没有人物名或人称代词开头的动作句，不要让句子显得碎片化、悬浮化。

描写应当流畅自然、充盈丰满。人物反应要有连续性，语言推进关系，动作承接情绪，神态补足潜台词。

作者备注应当像轻小说或网文的故事导语，面向玩家介绍角色卡主要内容和故事钩子，不要介绍图片来源，不要使用 Markdown 列表。`;
}

export const DEFAULT_STYLE_WORLD_ENTRY = readDefaultStyleWorldEntry();

export function defaultStyleWorldEntry(name = '默认文风世界书') {
  return {
    id: 1,
    name,
    keys: ['文风', '叙事', '作者备注', '开场白'],
    secondary_keys: [],
    comment: '默认轻网文/龙虾思路文风规则',
    content: DEFAULT_STYLE_WORLD_ENTRY,
    constant: true,
    selective: false,
    insertion_order: 100,
    enabled: true,
    position: 'before_char',
    case_sensitive: false,
    priority: 100,
    extensions: {
      position: 0,
      exclude_recursion: false,
      display_index: 0,
      probability: 100,
      useProbability: false,
      depth: 4,
      selectiveLogic: 0,
      group: '',
      group_override: false,
      group_weight: 100,
      prevent_recursion: false,
      delay_until_recursion: false,
      match_whole_words: null,
      scan_depth: null,
      use_group_scoring: false,
      automation_id: ''
    }
  };
}

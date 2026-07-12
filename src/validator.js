import { listFromSection, parseMarkdownCard, stripFence } from './card.js';

const REQUIRED_SECTIONS = ['名称', '描述', '性格', '场景', '开场白'];

function hasSection(sections, name) {
  return Object.prototype.hasOwnProperty.call(sections, name) && String(sections[name] || '').trim().length > 0;
}

function issue(code, severity, message, section = '') {
  return { code, severity, message, section };
}

export function validateCardMarkdown(markdown = '') {
  const sections = parseMarkdownCard(markdown);
  const issues = [];

  for (const section of REQUIRED_SECTIONS) {
    if (!hasSection(sections, section)) {
      issues.push(issue('missing_section', 'error', `缺少必需章节：${section}`, section));
    }
  }

  const knownHeadings = Object.keys(sections);
  if (!knownHeadings.length) {
    issues.push(issue('no_card_headings', 'error', '没有识别到角色卡一级标题'));
  }

  const description = sections['描述'] || '';
  if (description && !/^```ya?ml[\s\S]*```$/i.test(description.trim())) {
    issues.push(issue('description_not_yaml', 'warn', '描述章节建议使用 YAML 代码块', '描述'));
  } else if (description && !stripFence(description).includes(':')) {
    issues.push(issue('description_yaml_sparse', 'warn', '描述 YAML 看起来缺少键值结构', '描述'));
  }

  const opening = sections['开场白'] || '';
  const openingChars = (opening.match(/[\u3400-\u9fff]/g) || []).length;
  if (opening && openingChars < 120) {
    issues.push(issue('opening_too_short', 'warn', '开场白偏短，可能不够直接用于 first message', '开场白'));
  }
  if (opening && openingChars > 900) {
    issues.push(issue('opening_too_long', 'warn', '开场白偏长，建议压缩到更适合开局的一段', '开场白'));
  }

  const tags = listFromSection(sections['标签'] || '').slice(0, 99);
  if (tags.length > 10) {
    issues.push(issue('too_many_tags', 'warn', 'ST 标签超过 10 个，导出时会被截断', '标签'));
  }

  const drawingTags = listFromSection(sections['绘图标签'] || '', true);
  if (!drawingTags.length) {
    issues.push(issue('missing_drawing_tags', 'warn', '缺少绘图标签，搜图会缺少稳定输入', '绘图标签'));
  }
  const invalidDrawing = drawingTags.filter((tag) => /[\u3400-\u9fff]/.test(tag) || /\s/.test(tag.trim())).slice(0, 6);
  if (invalidDrawing.length) {
    issues.push(issue('drawing_tags_not_danbooru', 'warn', `绘图标签疑似不是 Danbooru tag：${invalidDrawing.join(', ')}`, '绘图标签'));
  }

  const blocking = issues.filter((item) => item.severity === 'error').length;
  return {
    ok: blocking === 0,
    status: blocking ? 'error' : issues.length ? 'warn' : 'ok',
    issues,
    stats: {
      sections: knownHeadings.length,
      openingChars,
      tagCount: tags.length,
      drawingTagCount: drawingTags.length
    }
  };
}

export function validationRepairPrompt(markdown, validation) {
  return [
    '请只修复下面 SillyTavern 角色卡 Markdown 的格式问题，保持原角色设定、文风、情节不变。',
    '必须输出完整 Markdown 角色卡，不要解释。',
    '需要修复的问题：',
    JSON.stringify(validation.issues, null, 2),
    '原 Markdown：',
    markdown
  ].join('\n\n');
}

export const SKILL_CATALOG = [
  {
    id: 'card-section-rewrite',
    name: '单区块重写',
    category: '写卡',
    description: '当用户点击预览区块或明确要求只修某一部分时使用；保持完整角色卡结构，只强化指定区块。',
    prompt: '只重写用户指定的角色卡区块。除非上下文一致性必须调整，否则不要大幅改动其他区块；最终仍输出完整 Markdown 角色卡。'
  },
  {
    id: 'image-search',
    name: 'Danbooru 搜图',
    category: '工具',
    description: '当用户需要给角色卡配图、换图、继续找图时使用；优先发色、常见服装和体型标签。',
    prompt: '根据角色外貌和用户要求整理 Danbooru tags。优先使用发色、t-shirt 等常见服装、huge_breasts 等稳定属性；一次建议 5 或 10 张候选，避免重复 post id。'
  },
  {
    id: 'web-search',
    name: '网页搜索',
    category: '工具',
    description: '当用户需要实时资料、网页来源、设定考据或外部信息时使用 Tavily 搜索。',
    prompt: '当问题依赖最新网页资料或明确要求搜索时，调用网页搜索；回答时基于搜索结果，不编造未出现的网页内容。'
  },
  {
    id: 'export-card',
    name: '导出 PNG/JSON',
    category: '工具',
    description: '当用户确认当前卡片可落盘、需要导出 ST PNG/JSON/Markdown 时使用。',
    prompt: '导出前检查角色卡章节完整、已选择图片或用户接受无图导出；导出到当前工作区，临时草稿进入 temp，正式产物留在工作区根层。'
  },
  {
    id: 'workspace-manage',
    name: '工作区管理',
    category: '工具',
    description: '当用户要新建、切换、整理、下载、删除或移动工作区文件时使用。',
    prompt: '对删除、覆盖、移动等危险动作先确认；正式卡片产物和 temp 临时素材分开管理，手机端优先提示下载目录位置。'
  },
  {
    id: 'openclaw-erotic-style',
    name: 'OpenClaw 色色文风',
    category: '文风',
    description: '用于成人角色卡的作者备注、开场白和场景氛围增强；强调暧昧、感官细节、心理拉扯和轻网文节奏。',
    prompt: '只用于明确成年且自愿的角色。写作者备注和开场白时，保持轻网文自然叙事，让语言、动作、神态、心理连续推进；用细腻感官、暧昧试探、欲望与后悔感制造张力。不要把内容写成生硬清单，不要让台词悬空，不要频繁单字成段。'
  }
];

export function skillCatalogPrompt() {
  return [
    '你可以根据用户意图自行选择是否使用下列 skills；只有真正有帮助时才使用，不要为了使用而使用。',
    '如果用户从界面显式选择了某个 skill，本轮优先遵循该 skill。',
    '',
    ...SKILL_CATALOG.map((skill) => `- ${skill.name} (${skill.id}): ${skill.description}`)
  ].join('\n');
}

export function selectedSkillPrompt(selected = []) {
  const ids = new Set((Array.isArray(selected) ? selected : []).map(String));
  const skills = SKILL_CATALOG.filter((skill) => ids.has(skill.id));
  if (!skills.length) return '';
  return [
    '本轮用户从 skill 列表中选择了以下 skill，请优先按这些 skill 的说明处理：',
    '',
    ...skills.map((skill) => `【${skill.name}】${skill.prompt}`)
  ].join('\n');
}

import { id, nowIso } from './store.js';

export const DEFAULT_CARD_PROMPT = `你是 SillyTavern 角色卡写卡器。根据用户需求生成 Tavern Card V2 角色卡内容，直接输出 Markdown，不要解释。

必须使用这些一级标题，且标题名保持中文：
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

规则：
- 所有成人向内容必须是明确成人、同意语境；不要写未成年、学校年龄段、胁迫或非自愿框架。
- 名称用轻小说/网文式情境标题，不要只写角色真名。
- 描述必须是 fenced yaml 块，至少包含 identity、appearance、primary_attributes。
- 开场白是一条完整 first message，默认 300-500 个汉字，至少三段自然段，段落之间空行。
- 默认不要状态栏。只有用户明确要求状态栏时才加入 description.status_bar 和系统提示词里的状态栏规则。
- 行文采用轻网文式自然叙事节奏。人物语言、动作、神态要彼此衔接；台词前后安排视线、表情、手部动作、停顿、姿态变化或心理反应。不要频繁用单字或单独成段短句烘托气氛。
- 作者备注是给玩家看的简介，不是图片来源。至少 180 个汉字，通常 6-12 个短段落；使用“你”作为玩家视角；包含 2-4 段中文引号台词；说明角色喜欢你、压力、欲望、害怕、误会、后悔或可能失去的东西；用疑问或未解悬念收尾；不要 Markdown 列表。
- 标签是 ST 检索标签，3-10 个，推荐 5-8 个；只写卡内设定能推出的标签，不要混入 1girl、solo、t-shirt 这类绘图标签。
- 绘图标签是 Danbooru 英文 tags，5-12 个。通常包含 1girl/1boy、solo、original，优先发色和常见服装；服装不明确时用 t-shirt。禁止 loli、shota、young、child、underage。

如果用户要求单独修改某部分，只输出完整 Markdown 角色卡，不要只输出片段。`;

export const DEFAULT_SECTION_REWRITE_PROMPT = `你是 SillyTavern 角色卡编辑器。用户会指定一个章节和修改要求。请保持其余章节不丢失，把目标章节重写得更好，并输出完整 Markdown 角色卡。

保持标题结构：
# 名称
# 描述
# 性格
# 场景
# 开场白
# 作者备注
# 标签
# 绘图标签

默认不要状态栏。标签最多十个。作者备注要是轻小说/网文式玩家导语，不要写图片来源。`;

export function defaultStore() {
  const createdAt = nowIso();
  const promptId = id('prompt');
  const modelId = id('model');
  return {
    version: 1,
    activeModelId: modelId,
    activePromptId: promptId,
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
    prompts: [
      {
        id: promptId,
        name: '龙虾角色卡规则',
        system: DEFAULT_CARD_PROMPT,
        rewrite: DEFAULT_SECTION_REWRITE_PROMPT,
        createdAt,
        updatedAt: createdAt
      }
    ],
    conversations: []
  };
}

export function buildMessages({ prompt, conversation, userText }) {
  const history = conversation.messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
  return [
    { role: 'system', content: prompt.system },
    ...history,
    { role: 'user', content: userText }
  ];
}

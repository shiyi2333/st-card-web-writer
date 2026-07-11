import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import Sortable from '../vendor/sortable.esm.js';

const CARD_SECTIONS = ['名称', '描述', '性格', '场景', '开场白', '作者备注', '标签', '绘图标签', '示例对话', '系统提示词', '备用开场白'];
const ROLES = ['system', 'developer', 'user', 'assistant'];
const BLOCK_TYPES = [
  ['normal', '普通块'],
  ['historyInject', '深度块'],
  ['userPrefix', '用户输入前缀'],
  ['skillSlot', '固定 Skill 文档'],
  ['historySlot', '对话历史占位'],
  ['inputSlot', '用户输入占位'],
  ['head', '固定头部'],
  ['main', '主提示词'],
  ['skill', 'skill指导块'],
  ['tail', '固定尾部']
];
const EDITABLE_BLOCK_TYPES = [
  ['normal', '普通块'],
  ['historyInject', '深度块']
];
const LOCKED_TYPES = new Set(['skillSlot', 'historySlot', 'inputSlot']);

const state = {
  settings: {},
  conversations: [],
  currentConversation: null,
  models: [],
  activeModelId: null,
  prompts: [],
  activePromptId: null,
  preview: null,
  selectedSection: '',
  selectedImage: null,
  avatarDataUrl: '',
  workspaces: [],
  files: [],
  lastUserText: '',
  skills: [],
  selectedSkills: [],
  imageSearch: {
    tags: '',
    page: 1,
    results: []
  },
  carousel: null,
  carouselTimer: null,
  promptSortable: null,
  messageRenderFrame: null,
  selectedSkillFilePath: '',
  queue: { tasks: [] },
  queueTimer: null
};

marked.setOptions({
  breaks: true,
  gfm: true,
  mangle: false,
  headerIds: false
});

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function markdownHtml(value) {
  return DOMPurify.sanitize(marked.parse(String(value || '')));
}

function compileThinkRegex() {
  const pattern = state.settings.thinkBlockRegex || '<Think>([\\s\\S]*?)</Think>';
  const rawFlags = state.settings.thinkBlockRegexFlags || 'gi';
  const flags = [...new Set(String(rawFlags).replace(/[^dgimsuvy]/g, '').split(''))].join('');
  try {
    return new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
  } catch {
    return /<Think>([\s\S]*?)<\/Think>/gi;
  }
}

function markdownWithThoughtsHtml(value) {
  const source = String(value || '');
  const regex = compileThinkRegex();
  let cursor = 0;
  let html = '';
  let matched = false;

  for (const match of source.matchAll(regex)) {
    if (!match[0]) continue;
    matched = true;
    if (match.index > cursor) html += markdownHtml(source.slice(cursor, match.index));
    const thought = match[1] ?? match[0];
    html += `
      <details class="think-block">
        <summary>思考过程</summary>
        <div class="think-content">${markdownHtml(thought)}</div>
      </details>
    `;
    cursor = match.index + match[0].length;
  }

  if (!matched) return markdownHtml(source);
  if (cursor < source.length) html += markdownHtml(source.slice(cursor));
  return html;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toast(text, kind = '') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = text;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2400);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || `请求失败: ${response.status}`);
  return payload;
}

function applyTheme(theme = 'system') {
  const resolved = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = resolved;
}

function setTab(name) {
  $$('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  $$('.panel').forEach((panel) => panel.classList.remove('active'));
  $(`#${name}Panel`)?.classList.add('active');
}

async function requestFullscreenMode(orientation = 'landscape') {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
    }
    try {
      await screen.orientation?.lock?.(orientation);
      toast(orientation === 'portrait' ? '已进入竖屏全屏' : '已进入横屏全屏');
    } catch {
      toast('已全屏；如果方向没有切换，请手动旋转手机');
    }
  } catch (error) {
    toast(`全屏失败: ${error.message}`, 'error');
  }
}

const requestLandscapeFullscreen = () => requestFullscreenMode('landscape');
const requestPortraitFullscreen = () => requestFullscreenMode('portrait');

async function loadHealth() {
  const health = await api('/api/health');
  state.settings = health.settings || {};
  applyTheme(state.settings.theme || 'system');
  $('#healthLine').textContent = health.activeModel ? `${health.activeModel.name} / ${health.activePrompt || '无预设'}` : '未配置模型';
  fillSettingsForm();
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  applyTheme(state.settings.theme || 'system');
  fillSettingsForm();
}

function fillSettingsForm() {
  $('#workspaceRootInput').value = state.settings.workspaceRoot || 'G:\\角色卡';
  $('#tavilyKeyInput').value = '';
  $('#tavilyKeyInput').placeholder = state.settings.hasTavilyKey ? state.settings.tavilyKey : '保存 Tavily API Key';
  $('#agentModeInput').value = state.settings.agentApprovalMode || 'confirm';
  $('#developerRoleModeInput').value = state.settings.developerRoleMode || 'compat';
  $('#themeInput').value = state.settings.theme || 'system';
  $('#imageCountInput').value = String(state.settings.imageResultCount || 10);
  $('#imageLimit').value = String(state.settings.imageResultCount || 10);
  $('#carouselTagsInput').value = state.settings.carouselTags || '1girl solo huge_breasts t-shirt';
  $('#thinkRegexInput').value = state.settings.thinkBlockRegex || '<Think>([\\s\\S]*?)</Think>';
  $('#thinkRegexFlagsInput').value = state.settings.thinkBlockRegexFlags || 'gi';
}

async function saveSettings(event) {
  event.preventDefault();
  const body = {
    workspaceRoot: $('#workspaceRootInput').value.trim(),
    agentApprovalMode: $('#agentModeInput').value,
    developerRoleMode: $('#developerRoleModeInput').value,
    theme: $('#themeInput').value,
    imageResultCount: Number($('#imageCountInput').value),
    carouselTags: $('#carouselTagsInput').value.trim(),
    thinkBlockRegex: $('#thinkRegexInput').value.trim(),
    thinkBlockRegexFlags: $('#thinkRegexFlagsInput').value.trim()
  };
  const key = $('#tavilyKeyInput').value.trim();
  if (key) body.tavilyKey = key;
  state.settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
  applyTheme(state.settings.theme);
  await loadWorkspaces();
  await loadCarousel();
  toast('设置已保存');
}

async function useDeviceWorkspaceRoot() {
  const payload = await api('/api/device-paths');
  $('#workspaceRootInput').value = payload.defaultWorkspaceRoot;
  toast('已填入设备默认目录，保存设置后生效');
}

async function loadSkills() {
  const payload = await api('/api/skills');
  state.skills = payload.skills || [];
  renderSkillPicker();
}

function renderSkillPicker() {
  const select = $('#skillSelect');
  if (!select) return;
  select.innerHTML = '<option value="">选择本轮 skill</option>';
  state.skills.forEach((skill) => {
    const option = document.createElement('option');
    option.value = skill.id;
    option.textContent = `${skill.name} · ${skill.category}`;
    option.title = skill.description;
    select.appendChild(option);
  });
  renderSelectedSkills();
}

function addSelectedSkill() {
  const id = $('#skillSelect').value;
  if (!id || state.selectedSkills.includes(id)) return;
  state.selectedSkills.push(id);
  renderSelectedSkills();
}

function renderSelectedSkills() {
  const row = $('#selectedSkillRow');
  if (!row) return;
  row.innerHTML = '';
  state.selectedSkills.forEach((skillId) => {
    const skill = state.skills.find((item) => item.id === skillId);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'skill-chip';
    chip.title = '点击移除本轮 skill';
    chip.textContent = skill ? skill.name : skillId;
    chip.addEventListener('click', () => {
      state.selectedSkills = state.selectedSkills.filter((item) => item !== skillId);
      renderSelectedSkills();
    });
    row.appendChild(chip);
  });
}

async function openSkillFiles() {
  const modal = $('#skillFilesModal');
  if (!modal) return;
  modal.hidden = false;
  await loadSkillFileTree();
}

function closeSkillFiles() {
  const modal = $('#skillFilesModal');
  if (modal) modal.hidden = true;
}

async function loadSkillFileTree() {
  const payload = await api('/api/skill-files/tree');
  const root = $('#skillFileTree');
  if (!root) return;
  root.innerHTML = renderSkillFileTree(payload.children || []);
  $$('#skillFileTree [data-skill-file]').forEach((button) => {
    button.addEventListener('click', () => loadSkillFile(button.dataset.skillFile).catch((error) => toast(error.message, 'error')));
  });
}

function renderSkillFileTree(nodes = []) {
  return nodes.map((node) => {
    if (node.type === 'directory') {
      return `
        <div class="skill-tree-node">
          <div class="skill-tree-title">▾ ${escapeHtml(node.name)}</div>
          <div class="skill-tree-group">${renderSkillFileTree(node.children || [])}</div>
        </div>
      `;
    }
    const active = node.path === state.selectedSkillFilePath ? ' active' : '';
    return `<button type="button" class="skill-tree-file${active}" data-skill-file="${escapeHtml(node.path)}">• ${escapeHtml(node.name)}</button>`;
  }).join('');
}

async function loadSkillFile(filePath) {
  const payload = await api(`/api/skill-files/file?path=${encodeURIComponent(filePath)}`);
  state.selectedSkillFilePath = payload.path;
  $('#skillFilePath').textContent = payload.path;
  $('#skillFileContent').value = payload.content;
  await loadSkillFileTree();
}

async function saveSkillFileFromModal() {
  if (!state.selectedSkillFilePath) {
    toast('先选择一个 skill 文件', 'error');
    return;
  }
  await api('/api/skill-files/file', {
    method: 'PUT',
    body: JSON.stringify({
      path: state.selectedSkillFilePath,
      content: $('#skillFileContent').value
    })
  });
  await loadSkills();
  toast('Skill 文件已保存');
}

async function loadCarousel() {
  const tags = encodeURIComponent(state.settings.carouselTags || '1girl solo huge_breasts t-shirt');
  const payload = await api(`/api/images/carousel?tags=${tags}`);
  renderCarousel(payload.results || [], payload.source, payload.warning);
}

function renderCarousel(images, source, warning) {
  const carousel = $('#heroCarousel');
  const wrapper = $('#carouselSlides');
  wrapper.innerHTML = '';
  stopCarouselFallback();
  if (!images.length) {
    wrapper.innerHTML = '<div class="swiper-slide carousel-empty">轮播图暂时没有加载出来</div>';
    carousel?.classList.add('carousel-ready');
    return;
  }
  images.slice(0, 10).forEach((image) => {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide';
    const imgUrl = image.sampleUrl || image.previewUrl || image.fileUrl;
    slide.innerHTML = `
      <img src="/api/images/proxy?url=${encodeURIComponent(imgUrl)}" alt="Danbooru ${image.id}">
      <div class="carousel-caption">
        <strong>Danbooru #${escapeHtml(image.id)}</strong>
        <span>${escapeHtml((image.tags || []).slice(0, 6).join(' '))}</span>
      </div>
    `;
    wrapper.appendChild(slide);
  });
  carousel?.classList.add('carousel-ready');
  if (state.carousel) {
    state.carousel.destroy(true, true);
    state.carousel = null;
  }
  if (window.Swiper && images.length > 1) {
    try {
      state.carousel = new window.Swiper('#heroCarousel', {
        loop: true,
        autoplay: { delay: 3200, disableOnInteraction: false },
        pagination: { el: '.swiper-pagination' },
        effect: 'slide'
      });
    } catch (error) {
      console.warn('Swiper carousel fallback enabled:', error);
      startCarouselFallback(wrapper);
    }
  } else {
    startCarouselFallback(wrapper);
  }
  if (source === 'cache' && warning) toast('轮播使用缓存图，实时 D 站加载失败');
}

function stopCarouselFallback() {
  if (state.carouselTimer) {
    clearInterval(state.carouselTimer);
    state.carouselTimer = null;
  }
}

function startCarouselFallback(wrapper) {
  const slides = [...wrapper.children];
  if (slides.length <= 1) return;
  let index = 0;
  state.carouselTimer = setInterval(() => {
    index = (index + 1) % slides.length;
    slides[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, 3200);
}

async function loadConversations() {
  state.conversations = await api('/api/conversations');
  renderConversations();
  if (!state.currentConversation && state.conversations[0]) {
    await selectConversation(state.conversations[0].id);
  }
}

function renderConversations() {
  const list = $('#conversationList');
  const mobileList = $('#mobileConversationList');
  list.innerHTML = '';
  if (mobileList) mobileList.innerHTML = '';
  state.conversations.forEach((conversation) => {
    list.appendChild(createConversationButton(conversation));
    if (mobileList) mobileList.appendChild(createConversationButton(conversation, true));
  });
}

function createConversationButton(conversation, mobile = false) {
  const button = document.createElement('button');
  button.className = `${mobile ? 'mobile-conversation-item' : 'conversation-item'} ${state.currentConversation?.id === conversation.id ? 'active' : ''}`;
  button.innerHTML = `<h3>${escapeHtml(conversation.title)}</h3><p>${conversation.messageCount} 条 / ${formatDate(conversation.updatedAt)}</p>`;
  button.addEventListener('click', () => {
    selectConversation(conversation.id)
      .then(() => {
        if (mobile) closeMobileConversationDrawer();
      })
      .catch((error) => toast(error.message, 'error'));
  });
  return button;
}

async function createConversation() {
  const title = $('#conversationTitle').value.trim() || '新角色卡';
  const conversation = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title }) });
  await loadConversations();
  await selectConversation(conversation.id);
}

async function selectConversation(id) {
  state.currentConversation = await api(`/api/conversations/${id}`);
  $('#conversationTitle').value = state.currentConversation.title;
  renderConversations();
  renderMessages({ forceScroll: true });
  renderMessageSelect();
  await refreshPreview().catch(() => {});
}

async function saveTitle() {
  if (!state.currentConversation) return;
  const title = $('#conversationTitle').value.trim();
  if (!title) return;
  if (title === state.currentConversation.title) return;
  await api(`/api/conversations/${state.currentConversation.id}`, { method: 'PUT', body: JSON.stringify({ title }) });
  await loadConversations();
  toast('标题已保存');
}

function toggleMobileConversationDrawer() {
  $('#mobileConversationDrawer')?.classList.toggle('open');
}

function closeMobileConversationDrawer() {
  $('#mobileConversationDrawer')?.classList.remove('open');
}

function messageRoleName(role) {
  return { user: '用户', assistant: '助手', tool: '工具' }[role] || role;
}

function toolResultHtml(tool = {}) {
  const meta = `
    <div class="tool-meta">
      <span>方法：${escapeHtml(tool.method || tool.action || 'agentAction')}</span>
      <span>状态：${escapeHtml(tool.status || 'unknown')}</span>
    </div>
  `;
  if (tool.action === 'web-search' && tool.result?.results?.length) {
    return `
      ${meta}
      <div class="tool-links">
        ${tool.result.results.map((item) => `
          <a class="tool-link-card" href="${escapeHtml(item.url)}" target="_blank">
            <strong>${escapeHtml(item.title || item.url)}</strong>
            <span>${escapeHtml(item.content || '')}</span>
            <em>${escapeHtml(item.url || '')}</em>
          </a>
        `).join('')}
      </div>
    `;
  }
  if (tool.action === 'image-search' && tool.result?.results?.length) {
    return `${meta}<div class="tool-grid">${tool.result.results.slice(0, 5).map((image) => `
      <img src="/api/images/proxy?url=${encodeURIComponent(image.previewUrl || image.sampleUrl || image.fileUrl)}" alt="Danbooru ${escapeHtml(image.id)}">
    `).join('')}</div>`;
  }
  return `${meta}<pre>${escapeHtml(JSON.stringify(tool.result || tool.error || {}, null, 2))}</pre>`;
}

function isNearMessageBottom(list) {
  if (!list) return true;
  return list.scrollHeight - list.scrollTop - list.clientHeight < 96;
}

function renderMessages(options = {}) {
  const list = $('#messageList');
  const shouldStick = options.forceScroll || isNearMessageBottom(list);
  list.innerHTML = '';
  if (!state.currentConversation) return;
  state.currentConversation.messages.forEach((message) => {
    const item = document.createElement('article');
    item.className = `message ${message.role}`;
    item.dataset.id = message.id;
    if (message.role === 'tool') {
      const tool = message.tool || {};
      item.innerHTML = `
        <div class="role"><span>工具: ${escapeHtml(tool.action || 'action')}</span><span>${formatDate(message.createdAt)}</span></div>
        <div class="tool-card ${tool.status === 'error' ? 'error' : ''} ${tool.status === 'running' ? 'running' : ''}">
          <strong>${tool.status === 'running' ? '<span class="spinner"></span>' : ''}${escapeHtml(tool.summary || message.content)}</strong>
          ${toolResultHtml(tool)}
        </div>
      `;
    } else {
      const skillNames = (message.skills || [])
        .map((skillId) => state.skills.find((skill) => skill.id === skillId)?.name || skillId)
        .join('、');
      item.innerHTML = `
        <div class="role">
          <span>${messageRoleName(message.role)}${message.section ? ` · ${escapeHtml(message.section)}` : ''}${skillNames ? ` · ${escapeHtml(skillNames)}` : ''}</span>
          <span>${formatDate(message.createdAt)}</span>
        </div>
        <div class="message-markdown">${message.pending ? '<span class="spinner"></span><span class="pending-text">等待回复...</span>' : ''}${message.error ? `<div class="inline-error">${escapeHtml(message.error)}</div>` : markdownWithThoughtsHtml(message.content)}</div>
        <details class="source-details"><summary>源码</summary><pre>${escapeHtml(message.content)}</pre></details>
        <div class="message-actions">
          <button class="mini-button" data-action="edit">编辑</button>
          ${message.role === 'assistant' ? '<button class="mini-button" data-action="preview">预览这条</button>' : ''}
          ${message.role === 'user' ? '<button class="mini-button" data-action="retry">按这条重试</button>' : ''}
        </div>
      `;
      item.querySelector('[data-action="edit"]').addEventListener('click', () => editMessage(message));
      item.querySelector('[data-action="preview"]')?.addEventListener('click', async () => {
        $('#messageSelect').value = message.id;
        setTab('preview');
        await refreshPreview();
      });
      item.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
        $('#messageInput').value = message.content;
        state.selectedSection = message.section || '';
        renderSectionChip();
      });
    }
    list.appendChild(item);
  });
  if (shouldStick) {
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }
}

function scheduleMessageRender(options = {}) {
  if (state.messageRenderFrame) return;
  state.messageRenderFrame = requestAnimationFrame(() => {
    state.messageRenderFrame = null;
    renderMessages(options);
  });
}

async function editMessage(message) {
  const next = prompt('编辑消息内容', message.content);
  if (next === null) return;
  await api(`/api/messages/${message.id}`, { method: 'PUT', body: JSON.stringify({ content: next }) });
  await selectConversation(state.currentConversation.id);
  toast('消息已更新');
}

function renderMessageSelect() {
  const select = $('#messageSelect');
  select.innerHTML = '';
  if (!state.currentConversation) return;
  const assistants = state.currentConversation.messages.filter((message) => message.role === 'assistant');
  assistants.forEach((message, index) => {
    const option = document.createElement('option');
    option.value = message.id;
    option.textContent = `助手回复 ${index + 1} / ${formatDate(message.createdAt)}`;
    select.appendChild(option);
  });
  if (assistants.at(-1)) select.value = assistants.at(-1).id;
}

function renderSectionChip() {
  const row = $('#sectionChipRow');
  row.innerHTML = '';
  if (!state.selectedSection) return;
  const chip = document.createElement('span');
  chip.className = 'section-chip';
  chip.textContent = `正在修改: ${state.selectedSection}`;
  row.appendChild(chip);
}

function chooseSection(name) {
  if (!confirm(`把「${name}」标记到当前输入框，接下来只修改这个部分？`)) return;
  state.selectedSection = name;
  renderSectionChip();
  setTab('chat');
  $('#messageInput').focus();
}

function clearSection() {
  state.selectedSection = '';
  renderSectionChip();
}

async function sendMessage(textOverride = '') {
  if (!state.currentConversation) await createConversation();
  if (state.isSending) return;
  const input = $('#messageInput');
  const content = (textOverride || input.value).trim();
  if (!content) return;
  state.isSending = true;
  $('#sendBtn').disabled = true;
  state.lastUserText = content;
  input.value = '';

  const selectedSkills = [...state.selectedSkills];
  const tempUser = { id: `tmp_${Date.now()}`, role: 'user', content, section: state.selectedSection, skills: selectedSkills, createdAt: new Date().toISOString() };
  const tempAssistant = { id: `stream_${Date.now()}`, role: 'assistant', content: '', section: state.selectedSection, pending: true, createdAt: new Date().toISOString() };
  state.currentConversation.messages.push(tempUser, tempAssistant);
  renderMessages({ forceScroll: true });

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: state.currentConversation.id, message: content, section: state.selectedSection, selectedSkills })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '发送失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find((item) => item.startsWith('data: '));
        if (!line) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        const payload = JSON.parse(data);
        if (payload.error) throw new Error(payload.error);
        handleStreamPayload(payload, tempAssistant);
      }
    }
    state.selectedSkills = [];
    renderSelectedSkills();
    await loadConversations();
  } catch (error) {
    tempAssistant.pending = false;
    tempAssistant.error = error.message;
    renderMessages();
    throw error;
  } finally {
    state.isSending = false;
    $('#sendBtn').disabled = false;
  }
}

function upsertToolMessage(payload, status, summary) {
  const id = payload.toolId || payload.toolMessage?.id || `tool_${Date.now()}`;
  let message = state.currentConversation.messages.find((item) => item.id === id);
  if (!message) {
    message = {
      id,
      role: 'tool',
      content: summary,
      createdAt: new Date().toISOString(),
      tool: { action: payload.action, status, summary }
    };
    state.currentConversation.messages.push(message);
  }
  message.tool = {
    ...(message.tool || {}),
    ...(payload.toolMessage?.tool || {}),
    action: payload.action || message.tool?.action,
    method: payload.method || payload.toolMessage?.tool?.method || message.tool?.method,
    status,
    summary,
    input: payload.input || message.tool?.input,
    result: payload.result || message.tool?.result,
    error: payload.error ? { message: payload.error } : message.tool?.error
  };
  message.content = summary;
  scheduleMessageRender();
}

function handleStreamPayload(payload, tempAssistant) {
  const event = payload.event || (payload.token ? 'token' : payload.done ? 'done' : '');
  if (event === 'skill_progress') {
    upsertToolMessage(payload, 'running', payload.message || '正在执行 skill...');
    return;
  }
  if (event === 'skill_start') {
    upsertToolMessage(payload, 'running', `开始执行: ${payload.action}`);
    return;
  }
  if (event === 'skill_result') {
    upsertToolMessage(payload, 'ok', payload.toolMessage?.tool?.summary || `已完成: ${payload.action}`);
    return;
  }
  if (event === 'skill_error') {
    upsertToolMessage(payload, 'error', payload.error || `执行失败: ${payload.action}`);
    return;
  }
  if (payload.token) {
    tempAssistant.pending = false;
    tempAssistant.content += payload.token;
    scheduleMessageRender();
  }
  if (payload.done && payload.message) {
    selectConversation(state.currentConversation.id).catch((error) => toast(error.message, 'error'));
  }
}

function regenerateLast() {
  const last = [...(state.currentConversation?.messages || [])].reverse().find((message) => message.role === 'user');
  const text = state.lastUserText || last?.content || '';
  if (!text) return toast('没有可重试的用户消息');
  $('#messageInput').value = text;
  sendMessage().catch((error) => toast(error.message, 'error'));
}

async function refreshPreview() {
  if (!state.currentConversation) return;
  const messageId = $('#messageSelect').value || undefined;
  state.preview = await api('/api/cards/preview', {
    method: 'POST',
    body: JSON.stringify({ conversationId: state.currentConversation.id, messageId })
  });
  renderPreview();
}

function renderPreview() {
  const stats = $('#previewStats');
  const grid = $('#sectionPreview');
  const json = $('#jsonPreview');
  stats.innerHTML = '';
  grid.innerHTML = '';
  if (!state.preview) {
    json.textContent = '';
    return;
  }

  [
    ['标题', state.preview.stats.title || '未识别'],
    ['ST 标签', state.preview.stats.tagCount],
    ['绘图标签', state.preview.stats.drawingTagCount],
    ['开场字数', state.preview.stats.openingChars],
    ['状态栏', state.preview.stats.hasStatusBar ? '有' : '无']
  ].forEach(([label, value]) => {
    const pill = document.createElement('span');
    pill.className = 'stat-pill';
    pill.innerHTML = `<b>${escapeHtml(label)}</b>${escapeHtml(value)}`;
    stats.appendChild(pill);
  });

  CARD_SECTIONS.forEach((name) => {
    const value = state.preview.sections[name];
    if (!value) return;
    const card = document.createElement('button');
    card.className = 'section-card';
    card.innerHTML = `
      <span class="section-kicker">${escapeHtml(state.preview.labels?.[name] || name)}</span>
      <h3>${escapeHtml(name)}</h3>
      <div class="section-markdown">${markdownHtml(value)}</div>
    `;
    card.addEventListener('click', () => chooseSection(name));
    grid.appendChild(card);
  });
  json.textContent = JSON.stringify(state.preview.json, null, 2);
}

async function exportCard(withPng) {
  if (!state.currentConversation) return;
  if (withPng && !state.avatarDataUrl) {
    toast('请先在搜图区选择一张图片');
    setTab('images');
    return;
  }
  const result = await maybeRunAction('导出角色卡到当前工作区', () => api('/api/cards/export', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: state.currentConversation.id,
      messageId: $('#messageSelect').value || undefined,
      avatarDataUrl: withPng ? state.avatarDataUrl : '',
      selectedImage: state.selectedImage
    })
  }));
  if (!result) return;
  $('#exportResult').innerHTML = [
    `<a href="${result.json}" target="_blank">JSON</a>`,
    `<a href="${result.markdown}" target="_blank">Markdown</a>`,
    result.png ? `<a href="${result.png}" target="_blank">PNG</a>` : ''
  ].filter(Boolean).join('');
  state.preview = result.preview;
  renderPreview();
  await loadFiles();
  await selectConversation(state.currentConversation.id);
  toast('已导出到当前工作区');
}

async function searchImages(reset = true) {
  const tags = $('#imageTags').value.trim() || state.preview?.json?.data?.extensions?.danbooru_tags?.join(' ') || '1girl solo t-shirt huge_breasts';
  $('#imageTags').value = tags;
  if (reset || state.imageSearch.tags !== tags) {
    state.imageSearch = { tags, page: 1, results: [] };
  }
  const limit = Number($('#imageLimit').value);
  const result = await runAgentAction('image-search', {
    tags,
    limit,
    page: state.imageSearch.page
  }, `用 Danbooru 搜图: ${tags}`);
  if (!result) return;
  const seen = new Set(state.imageSearch.results.map((item) => String(item.id)));
  for (const item of result.results) {
    if (!seen.has(String(item.id))) state.imageSearch.results.push(item);
  }
  state.imageSearch.page = result.next?.page || state.imageSearch.page + 1;
  renderImageResults({ ...result, results: state.imageSearch.results });
}

function renderImageResults(payload) {
  const grid = $('#imageResults');
  grid.innerHTML = '';
  $('#imagePageLine').textContent = `下一页 ${state.imageSearch.page}`;
  const queryLine = (payload.queries || []).map((query) => query.tags?.join(' ')).filter(Boolean).slice(0, 4).join(' / ');
  const warningLine = (payload.warnings || []).slice(0, 2).join(' | ');
  $('#selectedImageLine').innerHTML = [
    payload.rankedTags?.length ? `Ranked tags: ${escapeHtml(payload.rankedTags.slice(0, 10).join(' '))}` : '',
    queryLine ? `Queries: ${escapeHtml(queryLine)}` : '',
    warningLine ? `Warnings: ${escapeHtml(warningLine)}` : ''
  ].filter(Boolean).join('<br>') || $('#selectedImageLine').innerHTML;
  if (!payload.results.length) {
    grid.innerHTML = '<div class="empty-state">没有找到可用图片，放宽 tag 或换成 t-shirt / huge_breasts / hair color 试试。</div>';
    return;
  }
  payload.results.forEach((image) => {
    const card = document.createElement('article');
    card.className = 'image-card';
    const proxy = `/api/images/proxy?url=${encodeURIComponent(image.previewUrl || image.sampleUrl || image.fileUrl)}`;
    card.innerHTML = `
      <img src="${proxy}" alt="Danbooru ${image.id}" loading="lazy">
      <div class="image-meta">
        <strong>#${image.id}</strong>
        <span>rating:${escapeHtml(image.rating)} score:${escapeHtml(image.score)} match:${escapeHtml((image.matchedTags || []).join(' '))}</span>
        <p>${escapeHtml(image.tags.slice(0, 12).join(' '))}</p>
        <div class="button-row">
          <button class="mini-button" data-action="select">选择</button>
          <a class="mini-link" href="${escapeHtml(image.postUrl)}" target="_blank">原帖</a>
        </div>
      </div>
    `;
    card.querySelector('[data-action="select"]').addEventListener('click', () => selectImage(image));
    grid.appendChild(card);
  });
}

async function selectImage(image) {
  state.selectedImage = image;
  state.avatarDataUrl = await imageToPngDataUrl(image.sampleUrl || image.fileUrl || image.previewUrl);
  await api('/api/images/use', { method: 'POST', body: JSON.stringify({ id: image.id }) });
  $('#selectedImageLine').innerHTML = `已选择 Danbooru <a href="${image.postUrl}" target="_blank">#${image.id}</a>，导出 PNG 会使用这张图。`;
  toast('图片已选择');
}

async function imageToPngDataUrl(url) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  const proxied = `/api/images/proxy?url=${encodeURIComponent(url)}`;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = proxied;
  });
  const canvas = document.createElement('canvas');
  const size = 512;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const scale = Math.max(size / image.width, size / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  return canvas.toDataURL('image/png');
}

async function webSearch() {
  const query = $('#webQuery').value.trim();
  if (!query) return;
  const result = await runAgentAction('web-search', { query, maxResults: 5 }, `Tavily 网页搜索: ${query}`);
  if (!result) return;
  renderWebResults(result);
}

function renderWebResults(payload) {
  const list = $('#webSearchResults');
  list.innerHTML = '';
  if (payload.answer) {
    const answer = document.createElement('article');
    answer.className = 'search-answer';
    answer.textContent = payload.answer;
    list.appendChild(answer);
  }
  (payload.results || []).forEach((item) => {
    const card = document.createElement('article');
    card.className = 'search-card';
    card.innerHTML = `
      <a href="${escapeHtml(item.url)}" target="_blank">${escapeHtml(item.title)}</a>
      <p>${escapeHtml(item.content)}</p>
      <span>${escapeHtml(item.url)}</span>
    `;
    list.appendChild(card);
  });
}

async function maybeRunAction(label, fn) {
  if ((state.settings.agentApprovalMode || 'confirm') === 'confirm' && !confirm(`执行工具动作：${label}`)) return null;
  return fn();
}

async function runAgentAction(action, payload, label) {
  if ((state.settings.agentApprovalMode || 'confirm') === 'confirm' && !confirm(`执行工具动作：${label}`)) return null;
  if (!state.currentConversation) await createConversation();
  upsertToolMessage({ toolId: `manual_${Date.now()}`, action, input: payload }, 'running', `正在执行: ${label}`);
  const response = await api('/api/agent/actions', {
    method: 'POST',
    body: JSON.stringify({ conversationId: state.currentConversation.id, action, ...payload })
  });
  await selectConversation(state.currentConversation.id);
  return response.result;
}

async function loadWorkspaces() {
  const payload = await api('/api/workspaces');
  state.workspaces = payload.workspaces || [];
  state.settings.currentWorkspace = payload.current || state.settings.currentWorkspace || '';
  $('#workspaceRootLine').textContent = `根目录：${payload.root || ''}`;
  renderWorkspaceSelect();
  await loadFiles().catch(() => {});
}

function renderWorkspaceSelect() {
  const select = $('#workspaceSelect');
  select.innerHTML = '';
  state.workspaces.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  select.value = state.settings.currentWorkspace || state.workspaces[0] || '';
}

async function createOrSwitchWorkspace() {
  const typed = $('#workspaceName').value.trim();
  const selected = $('#workspaceSelect').value;
  const name = typed || selected || '默认工作区';
  await api('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }) });
  $('#workspaceName').value = '';
  await loadWorkspaces();
  toast(`已切换到 ${name}`);
}

async function renameWorkspace() {
  const from = $('#workspaceSelect').value;
  if (!from) return;
  const to = prompt('工作区改名为', from);
  if (!to || to === from) return;
  await api('/api/workspaces/name', { method: 'PUT', body: JSON.stringify({ from, to }) });
  await loadWorkspaces();
  toast('工作区已改名');
}

async function deleteWorkspace() {
  const name = $('#workspaceSelect').value;
  if (!name) return;
  if (!confirm(`确认删除工作区「${name}」？里面的文件也会删除。`)) return;
  await api('/api/workspaces', { method: 'DELETE', body: JSON.stringify({ name }) });
  await loadWorkspaces();
  toast('工作区已删除');
}

async function switchWorkspace() {
  const name = $('#workspaceSelect').value;
  if (!name) return;
  await api('/api/workspaces/current', { method: 'PUT', body: JSON.stringify({ name }) });
  await loadWorkspaces();
}

async function loadFiles() {
  const payload = await api('/api/workspaces/files');
  state.files = payload.files || [];
  renderFiles();
}

function renderFiles() {
  const list = $('#fileList');
  list.innerHTML = '';
  if (!state.files.length) {
    list.innerHTML = '<div class="empty-state">当前工作区还没有文件。</div>';
    return;
  }
  state.files.forEach((file) => {
    const item = document.createElement('article');
    item.className = `file-item ${file.isTemp ? 'temp' : ''}`;
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <p>${file.type} / ${Math.ceil(file.size / 1024)} KB / ${formatDate(file.updatedAt)}</p>
      </div>
      <div class="button-row">
        ${file.download ? `<a class="mini-link" href="${file.download}" target="_blank">下载</a>` : ''}
        ${file.name !== 'temp' ? '<button class="mini-button" data-action="move">移动</button><button class="mini-button" data-action="rename">改名</button><button class="mini-button danger" data-action="delete">删除</button>' : ''}
      </div>
    `;
    item.querySelector('[data-action="move"]')?.addEventListener('click', () => moveFile(file.name));
    item.querySelector('[data-action="rename"]')?.addEventListener('click', () => renameFile(file.name));
    item.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteFile(file.name));
    list.appendChild(item);
  });
}

async function renameFile(name) {
  const to = prompt('改名为', name);
  if (!to || to === name) return;
  await api('/api/workspaces/item', { method: 'PUT', body: JSON.stringify({ from: name, to }) });
  await loadFiles();
}

async function deleteFile(name) {
  if (!confirm(`确认删除 ${name}？这个操作不能撤销。`)) return;
  await api('/api/workspaces/item', { method: 'DELETE', body: JSON.stringify({ name }) });
  await loadFiles();
}

async function moveFile(name) {
  const fromWorkspace = state.settings.currentWorkspace || $('#workspaceSelect').value;
  const toWorkspace = prompt('移动到哪个工作区？', state.workspaces.find((item) => item !== fromWorkspace) || fromWorkspace);
  if (!toWorkspace || toWorkspace === fromWorkspace) return;
  await api('/api/workspaces/move', {
    method: 'POST',
    body: JSON.stringify({ fromWorkspace, itemName: name, toWorkspace })
  });
  await loadFiles();
  toast('文件已移动');
}

async function loadModels() {
  const payload = await api('/api/models');
  state.models = payload.models;
  state.activeModelId = payload.activeId;
  renderModels();
}

function renderModels() {
  const list = $('#modelList');
  list.innerHTML = '';
  state.models.forEach((model) => {
    const button = document.createElement('button');
    button.className = `stack-item ${model.id === state.activeModelId ? 'active' : ''}`;
    button.innerHTML = `<h3>${escapeHtml(model.name)}</h3><p>${escapeHtml(model.provider || 'openai')} / ${escapeHtml(model.model)} / ${escapeHtml(model.apiKey || '未保存 key')}</p>`;
    button.addEventListener('click', () => fillModelForm(model));
    list.appendChild(button);
  });
  const active = state.models.find((model) => model.id === state.activeModelId) || state.models[0];
  if (active) fillModelForm(active);
}

function fillModelForm(model = {}) {
  $('#modelId').value = model.id || '';
  $('#modelName').value = model.name || '';
  $('#modelProviderInput').value = model.provider || 'openai';
  $('#modelBaseUrl').value = model.baseUrl || 'https://api.deepseek.com';
  $('#modelApiKey').value = '';
  $('#modelApiKey').placeholder = model.apiKey || '留空则不修改已保存 key';
  $('#modelIdText').value = model.model || 'deepseek-v4-pro';
  $('#modelTemperature').value = model.temperature ?? 0.8;
}

async function saveModel(event) {
  event.preventDefault();
  const idValue = $('#modelId').value;
  const body = {
    name: $('#modelName').value.trim(),
    provider: $('#modelProviderInput').value,
    baseUrl: $('#modelBaseUrl').value.trim(),
    model: $('#modelIdText').value.trim(),
    temperature: Number($('#modelTemperature').value || 0.8)
  };
  const key = $('#modelApiKey').value;
  if (key || !idValue) body.apiKey = key;
  const saved = idValue
    ? await api(`/api/models/${idValue}`, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/api/models', { method: 'POST', body: JSON.stringify(body) });
  const activeId = saved.model?.id || idValue;
  await api(`/api/models/${activeId}/activate`, { method: 'POST' });
  await loadModels();
  await loadHealth();
  toast('模型已保存');
}

async function fetchRemoteModels() {
  const body = {
    provider: $('#modelProviderInput').value,
    baseUrl: $('#modelBaseUrl').value.trim(),
    apiKey: $('#modelApiKey').value,
    model: $('#modelIdText').value.trim()
  };
  if (!body.apiKey && $('#modelId').value) body.id = $('#modelId').value;
  const payload = await api('/api/models/fetch', { method: 'POST', body: JSON.stringify(body) });
  const select = $('#remoteModelSelect');
  select.innerHTML = '<option value="">选择远端模型</option>';
  payload.models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.id;
    select.appendChild(option);
  });
  toast(`拉取到 ${payload.models.length} 个模型`);
}

async function loadPrompts() {
  const payload = await api('/api/prompts');
  state.prompts = payload.prompts;
  state.activePromptId = payload.activeId;
  renderPrompts();
}

function renderPrompts() {
  const list = $('#promptList');
  list.innerHTML = '';
  state.prompts.forEach((prompt) => {
    const button = document.createElement('button');
    button.className = `stack-item ${prompt.id === state.activePromptId ? 'active' : ''}`;
    button.innerHTML = `<h3>${escapeHtml(prompt.name)}</h3><p>${prompt.messages?.length || 0} 块 / ${formatDate(prompt.updatedAt)}</p>`;
    button.addEventListener('click', () => fillPromptForm(prompt));
    list.appendChild(button);
  });
  const active = state.prompts.find((prompt) => prompt.id === state.activePromptId) || state.prompts[0];
  if (active) fillPromptForm(active);
}

function fillPromptForm(prompt = {}) {
  $('#promptId').value = prompt.id || '';
  $('#promptName').value = prompt.name || '';
  $('#importPreview').innerHTML = '';
  renderPromptMessages(prompt.messages || []);
}

function blockTypeOptions(selected) {
  return BLOCK_TYPES.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function roleOptions(selected) {
  return ROLES.map((role) => `<option value="${role}" ${role === selected ? 'selected' : ''}>${role}</option>`).join('');
}

function defaultPromptMessages() {
  return [
    { type: 'normal', role: 'system', title: '空开头', content: '', enabled: true, order: 10 },
    {
      type: 'normal',
      role: 'system',
      title: '总简介提示词',
      content: '你是一个通用助手，可以自然讨论各种主题，也可以在用户需要时协助完成写作、搜索、文件整理和 SillyTavern 角色卡制作。\n\n默认情况下按普通对话回答，不要主动输出角色卡 Markdown，也不要擅自进入固定角色卡格式。\n固定 Skill 文档会在运行时提供可用能力目录；只有用户意图明确或用户手动选择 skill 时，才读取并应用对应 skill。',
      enabled: true,
      order: 20
    },
    { type: 'skillSlot', role: 'developer', title: '固定 Skill 文档', enabled: true, locked: true, order: 30 },
    { type: 'historySlot', role: 'system', title: '对话历史', enabled: true, locked: true, order: 40 },
    { type: 'normal', role: 'system', title: '空结尾', content: '', enabled: true, order: 50 }
  ];
}

function renderPromptMessages(messages) {
  const list = $('#promptMessageList');
  list.innerHTML = '';
  messages.slice().sort((a, b) => a.order - b.order).forEach((message) => addPromptMessage(message));
  if (state.promptSortable) state.promptSortable.destroy();
  state.promptSortable = new Sortable(list, {
    animation: 160,
    handle: '.drag-handle',
    ghostClass: 'drag-ghost'
  });
}

function addPromptMessage(message = {}) {
  const list = $('#promptMessageList');
  const type = message.type || $('#newPromptType')?.value || 'normal';
  const locked = message.locked || LOCKED_TYPES.has(type);
  const lockedHelp = {
    skillSlot: '运行时自动读取 skills/*.md 并组合成固定 Skill 文档。这个块只表示插入位置；内容请从 Skill 文件库打开编辑。',
    historySlot: '运行时插入当前会话历史。导入 ST 预设时，ST 自带 chatHistory 会被剔除；即使没有此块，后端也会在末尾加入历史和本轮输入。',
    inputSlot: '旧版兼容块；新预设不再需要单独的用户输入占位。'
  };
  const row = document.createElement('article');
  row.className = `prompt-message type-${type}`;
  row.dataset.id = message.id || `new_${Date.now()}_${Math.random()}`;
  row.dataset.locked = locked ? 'true' : 'false';
  row.dataset.identifier = message.identifier || '';
  row.dataset.injectionDepth = message.injectionDepth ?? '';
  row.dataset.injectionPosition = message.injectionPosition ?? '';
  row.dataset.injectionOrder = message.injectionOrder ?? '';
  row.dataset.injectionTrigger = JSON.stringify(Array.isArray(message.injectionTrigger) ? message.injectionTrigger : []);
  row.dataset.forbidOverrides = message.forbidOverrides ? 'true' : 'false';
  row.dataset.systemPrompt = message.systemPrompt ? 'true' : 'false';
  row.dataset.marker = message.marker ? 'true' : 'false';
  row.dataset.characterId = message.characterId ?? '';
  const metaParts = [
    message.characterId !== undefined && message.characterId !== null ? `character_id=${message.characterId}` : '',
    message.identifier ? `identifier=${message.identifier}` : '',
    message.role ? `role=${message.role}` : '',
    message.injectionDepth !== undefined && message.injectionDepth !== null ? `depth=${message.injectionDepth}` : '',
    message.injectionPosition ? `position=${message.injectionPosition}` : '',
    message.injectionOrder !== undefined && message.injectionOrder !== null ? `injection_order=${message.injectionOrder}` : '',
    Array.isArray(message.injectionTrigger) && message.injectionTrigger.length ? `trigger=${message.injectionTrigger.join(', ')}` : '',
    message.forbidOverrides ? 'forbid_overrides=true' : '',
    message.marker ? 'marker=true' : ''
  ].filter(Boolean);
  const typeControl = locked
    ? `<span class="macro-label">MACRO / ${escapeHtml(BLOCK_TYPES.find(([value]) => value === type)?.[1] || type)}</span><input type="hidden" data-field="type" value="${escapeHtml(type)}">`
    : `<select data-field="type">${EDITABLE_BLOCK_TYPES.map(([value, label]) => `<option value="${value}" ${value === type ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  const removeButton = locked ? '' : '<button type="button" class="mini-button danger" data-action="remove">删除</button>';
  row.innerHTML = `
    <div class="prompt-message-head">
      <span class="drag-handle">拖动</span>
      ${typeControl}
      <select data-field="role">${roleOptions(message.role || 'system')}</select>
      <input data-field="title" placeholder="提示词名称" value="${escapeHtml(message.title || BLOCK_TYPES.find(([value]) => value === type)?.[1] || '新提示词')}">
      <label class="inject-field">深度 <input data-field="injectionDepth" type="number" min="0" step="1" value="${message.injectionDepth ?? 0}"><span>0=用户下方，1=用户上方</span></label>
      <label class="inject-field">位置 <input data-field="injectionPosition" placeholder="ST position" value="${escapeHtml(message.injectionPosition || '')}"></label>
      <label class="toggle"><input data-field="enabled" type="checkbox" ${message.enabled === false ? '' : 'checked'}>启用</label>
      ${removeButton}
    </div>
    ${metaParts.length ? `<div class="prompt-message-meta">${escapeHtml(metaParts.join(' / '))}</div>` : ''}
    ${locked ? `<div class="macro-help"><strong>MACRO / ${escapeHtml(BLOCK_TYPES.find(([value]) => value === type)?.[1] || type)}</strong><br>${escapeHtml(lockedHelp[type] || '运行时自动插入，不能编辑内容。')}${type === 'skillSlot' ? '<br><button type="button" class="mini-button" data-action="open-skills">文件列表</button>' : ''}</div>` : ''}
    <textarea data-field="content" rows="7" ${locked ? 'hidden disabled' : ''} placeholder="${locked ? '运行时自动插入，不能编辑内容' : '输入提示词内容'}">${escapeHtml(locked ? '' : message.content || '')}</textarea>
  `;
  row.querySelector('[data-action="remove"]')?.addEventListener('click', () => row.remove());
  row.querySelector('[data-action="open-skills"]')?.addEventListener('click', () => openSkillFiles().catch((error) => toast(error.message, 'error')));
  row.querySelector('select[data-field="type"]')?.addEventListener('change', (event) => {
    const nextType = event.target.value;
    const isLocked = LOCKED_TYPES.has(nextType);
    row.dataset.locked = isLocked ? 'true' : 'false';
    row.className = `prompt-message type-${nextType}`;
    const textarea = row.querySelector('[data-field="content"]');
    textarea.disabled = isLocked;
    textarea.hidden = isLocked;
    if (isLocked) {
      textarea.value = '';
      textarea.placeholder = lockedHelp[nextType] || '运行时自动插入，不能编辑内容';
    } else {
      textarea.placeholder = '输入提示词内容';
    }
  });
  list.appendChild(row);
}

function parsePromptJsonMeta(value, fallback = []) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : fallback;
  } catch {
    return fallback;
  }
}

function collectPromptMessages() {
  return $$('#promptMessageList .prompt-message').map((row, index) => {
    const type = row.querySelector('[data-field="type"]').value;
    const locked = LOCKED_TYPES.has(type);
    const depthField = row.querySelector('[data-field="injectionDepth"]')?.value;
    const positionField = row.querySelector('[data-field="injectionPosition"]')?.value.trim() || '';
    const hasPreservedDepth = row.dataset.injectionDepth !== undefined && row.dataset.injectionDepth !== '';
    const hasPreservedPosition = row.dataset.injectionPosition !== undefined && row.dataset.injectionPosition !== '';
    const hasInjectionDepth = type === 'historyInject' || hasPreservedDepth;
    const hasInjectionPosition = type === 'historyInject' || hasPreservedPosition;
    const injectionOrder = row.dataset.injectionOrder !== undefined && row.dataset.injectionOrder !== '' ? Number(row.dataset.injectionOrder) : null;
    return {
      id: row.dataset.id.startsWith('new_') ? undefined : row.dataset.id,
      type,
      role: row.querySelector('[data-field="role"]').value,
      title: row.querySelector('[data-field="title"]').value.trim() || `提示词 ${index + 1}`,
      content: locked ? '' : row.querySelector('[data-field="content"]').value,
      enabled: row.querySelector('[data-field="enabled"]').checked,
      locked,
      identifier: row.dataset.identifier || '',
      injectionDepth: hasInjectionDepth ? Math.max(0, Number(depthField || 0) || 0) : null,
      injectionPosition: hasInjectionPosition ? positionField : '',
      injectionOrder: Number.isFinite(injectionOrder) ? injectionOrder : null,
      injectionTrigger: parsePromptJsonMeta(row.dataset.injectionTrigger, []),
      forbidOverrides: row.dataset.forbidOverrides === 'true',
      systemPrompt: row.dataset.systemPrompt === 'true',
      marker: row.dataset.marker === 'true',
      characterId: row.dataset.characterId !== undefined && row.dataset.characterId !== '' ? Number(row.dataset.characterId) : null,
      order: (index + 1) * 10
    };
  });
}

async function savePrompt(event) {
  event.preventDefault();
  const idValue = $('#promptId').value;
  const body = {
    name: $('#promptName').value.trim() || '未命名预设',
    messages: collectPromptMessages()
  };
  const saved = idValue
    ? await api(`/api/prompts/${idValue}`, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/api/prompts', { method: 'POST', body: JSON.stringify(body) });
  const activeId = saved.prompt?.id || idValue;
  await api(`/api/prompts/${activeId}/activate`, { method: 'POST' });
  await loadPrompts();
  await loadHealth();
  toast('预设已保存');
}

async function importStPreset(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const json = JSON.parse(await file.text());
  const endpoint = json?.type === 'st-card-web-writer-prompt-preset' ? '/api/prompts/import' : '/api/prompts/import-st';
  const result = await api(endpoint, { method: 'POST', body: JSON.stringify(json) });
  const importedPrompts = (result.prompts || [result.prompt]).filter(Boolean);
  const mappings = result.mappings?.length ? result.mappings : [{ characterId: result.prompt?.messages?.[0]?.characterId, mapping: result.mapping || [] }];
  const summary = mappings.map((group, index) => {
    const rows = group.mapping || [];
    const depthCount = rows.filter((item) => item.injectionDepth !== null && item.injectionDepth !== undefined).length;
    const disabledCount = rows.filter((item) => item.enabled === false).length;
    const characterLabel = group.characterId !== null && group.characterId !== undefined ? `character_id=${group.characterId}` : `order ${index + 1}`;
    return escapeHtml(`${characterLabel}: ${rows.length} blocks, depth ${depthCount}, disabled ${disabledCount}`);
  }).join('<br>');
  const activeMapping = mappings.find((group) => group.promptId === result.activeId || group.promptId === result.prompt?.id)?.mapping || result.mapping || mappings.at(-1)?.mapping || [];
  const detail = activeMapping.slice(0, 36).map((item) => {
    const depth = item.injectionDepth !== null && item.injectionDepth !== undefined ? ` depth=${item.injectionDepth}` : '';
    const position = item.injectionPosition ? ` position=${item.injectionPosition}` : '';
    const injectionOrder = item.injectionOrder !== null && item.injectionOrder !== undefined ? ` injection_order=${item.injectionOrder}` : '';
    const role = item.role ? ` role=${item.role}` : '';
    return escapeHtml(`${item.identifier || item.title} -> ${item.type}${role}${depth}${position}${injectionOrder}${item.enabled ? '' : ' disabled'}`);
  }).join('<br>');
  $('#importPreview').innerHTML = `
    <strong>已导入 ${importedPrompts.length} 个 ST 预设，当前激活：${escapeHtml(result.prompt?.name || '')}</strong>
    <p>${summary}</p>
    <p>${detail}${activeMapping.length > 36 ? '<br>...' : ''}</p>
  `;
  await loadPrompts();
  fillPromptForm(result.prompt);
  toast(`ST 预设已导入 ${importedPrompts.length} 个`);
  event.target.value = '';
}

function exportCurrentPrompt() {
  const currentId = $('#promptId').value;
  const existing = state.prompts.find((item) => item.id === currentId) || state.prompts.find((item) => item.id === state.activePromptId);
  if (!existing && !$('#promptName').value.trim()) {
    toast('没有可导出的预设', 'error');
    return;
  }
  const prompt = {
    ...(existing || {}),
    id: currentId || existing?.id || `prompt_export_${Date.now()}`,
    name: $('#promptName').value.trim() || existing?.name || '未命名预设',
    messages: collectPromptMessages(),
    exportedUnsavedForm: true
  };
  const payload = {
    type: 'st-card-web-writer-prompt-preset',
    version: 1,
    exportedAt: new Date().toISOString(),
    prompt
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(prompt.name || 'prompt-preset').replace(/[\\/:*?"<>|]+/g, '_')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('预设已导出');
}

async function loadQueue() {
  state.queue = await api('/api/queue');
  renderQueue();
}

function queueStatusName(status) {
  return {
    queued: '等待中',
    running: '生成中',
    paused: '已暂停',
    done: '已完成',
    failed: '有失败',
    cancelled: '已取消'
  }[status] || status || '未知';
}

function queueItemLinks(item) {
  const links = [];
  if (item.conversationId) {
    links.push(`<button class="mini-button" data-action="open-conversation" data-conversation="${escapeHtml(item.conversationId)}">打开对话</button>`);
  }
  if (item.exportResult?.markdown) links.push(`<a class="mini-link" href="${escapeHtml(item.exportResult.markdown)}" target="_blank">Markdown</a>`);
  if (item.exportResult?.json) links.push(`<a class="mini-link" href="${escapeHtml(item.exportResult.json)}" target="_blank">JSON</a>`);
  if (item.status === 'failed' || item.status === 'cancelled') {
    links.push(`<button class="mini-button" data-action="retry-item" data-item="${escapeHtml(item.id)}">重试</button>`);
  }
  return links.join('');
}

function renderQueue() {
  const tasks = state.queue?.tasks || [];
  const list = $('#queueTaskList');
  const statusLine = $('#queueStatusLine');
  if (!list || !statusLine) return;
  const running = tasks.find((task) => task.status === 'running');
  statusLine.textContent = running ? `生成中：${running.title}` : `${tasks.length} 个任务`;
  if (!tasks.length) {
    list.innerHTML = '<div class="empty-card">还没有队列任务。</div>';
    return;
  }
  list.innerHTML = tasks.map((task) => {
    const done = (task.items || []).filter((item) => item.status === 'done').length;
    const total = (task.items || []).length || task.count || 0;
    const percent = total ? Math.round((done / total) * 100) : 0;
    return `
      <article class="queue-task ${escapeHtml(task.status)}" data-task="${escapeHtml(task.id)}">
        <div class="queue-task-head">
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <p>${escapeHtml(task.mode === 'outline' ? '先列设定再完善' : '直接多卡生成')} / ${queueStatusName(task.status)} / ${done}/${total || task.count}</p>
          </div>
          <div class="queue-task-actions">
            <button class="mini-button" data-action="run-task">开始</button>
            <button class="mini-button" data-action="retry-task">重试失败</button>
            <button class="mini-button" data-action="cancel-task">取消</button>
          </div>
        </div>
        <div class="queue-progress"><span style="width:${percent}%"></span></div>
        <div class="queue-items">
          ${(task.items || []).map((item, index) => `
            <div class="queue-item ${escapeHtml(item.status)}">
              <div>
                <strong>${index + 1}. ${escapeHtml(item.title || item.brief || '未命名角色')}</strong>
                <p>${escapeHtml(item.brief || '')}</p>
                ${item.error ? `<p class="inline-error">${escapeHtml(item.error)}</p>` : ''}
              </div>
              <div class="queue-item-actions">
                <span class="mode-pill">${queueStatusName(item.status)}</span>
                ${queueItemLinks(item)}
              </div>
            </div>
          `).join('')}
        </div>
      </article>
    `;
  }).join('');

  $$('#queueTaskList [data-action="run-task"]').forEach((button) => {
    button.addEventListener('click', () => runQueue(button.closest('[data-task]')?.dataset.task).catch((error) => toast(error.message, 'error')));
  });
  $$('#queueTaskList [data-action="retry-task"]').forEach((button) => {
    button.addEventListener('click', () => retryQueue(button.closest('[data-task]')?.dataset.task).catch((error) => toast(error.message, 'error')));
  });
  $$('#queueTaskList [data-action="cancel-task"]').forEach((button) => {
    button.addEventListener('click', () => cancelQueue(button.closest('[data-task]')?.dataset.task).catch((error) => toast(error.message, 'error')));
  });
  $$('#queueTaskList [data-action="retry-item"]').forEach((button) => {
    button.addEventListener('click', () => retryQueue(button.closest('[data-task]')?.dataset.task, button.dataset.item).catch((error) => toast(error.message, 'error')));
  });
  $$('#queueTaskList [data-action="open-conversation"]').forEach((button) => {
    button.addEventListener('click', () => selectConversation(button.dataset.conversation).then(() => setTab('chat')).catch((error) => toast(error.message, 'error')));
  });
}

async function createQueueTask(event) {
  event.preventDefault();
  const body = {
    title: $('#queueTitle').value.trim(),
    mode: $('#queueMode').value,
    count: Number($('#queueCount').value || 1),
    autoExport: $('#queueAutoExport').checked,
    seedText: $('#queueSeedText').value.trim(),
    itemsText: $('#queueItemsText').value.trim()
  };
  if (!body.seedText && !body.itemsText) return toast('先写任务说明或条目', 'error');
  const payload = await api('/api/queue/tasks', { method: 'POST', body: JSON.stringify(body) });
  state.queue = payload.queue;
  renderQueue();
  toast('已加入生成队列');
}

async function runQueue(taskId = '') {
  const payload = await api('/api/queue/run', { method: 'POST', body: JSON.stringify({ taskId }) });
  state.queue = payload.queue;
  renderQueue();
  startQueuePolling();
  toast('队列开始运行');
}

async function pauseQueue() {
  const payload = await api('/api/queue/pause', { method: 'POST', body: JSON.stringify({}) });
  state.queue = payload.queue;
  renderQueue();
  toast('队列已暂停');
}

async function cancelQueue(taskId = '') {
  const payload = await api('/api/queue/cancel', { method: 'POST', body: JSON.stringify({ taskId }) });
  state.queue = payload.queue;
  renderQueue();
  toast('队列已取消');
}

async function retryQueue(taskId = '', itemId = '') {
  const payload = await api('/api/queue/retry', { method: 'POST', body: JSON.stringify({ taskId, itemId }) });
  state.queue = payload.queue;
  renderQueue();
  startQueuePolling();
  toast('已重新加入队列');
}

function startQueuePolling() {
  if (state.queueTimer) clearInterval(state.queueTimer);
  state.queueTimer = setInterval(async () => {
    try {
      await loadQueue();
      const active = (state.queue?.tasks || []).some((task) => ['queued', 'running', 'paused'].includes(task.status));
      if (!active && state.queueTimer) {
        clearInterval(state.queueTimer);
        state.queueTimer = null;
      }
    } catch (error) {
      console.warn('queue polling failed:', error);
    }
  }, 2500);
}

function wireEvents() {
  $$('.tab-button').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $('#fullscreenFab').addEventListener('click', requestLandscapeFullscreen);
  $('#portraitFullscreenFab').addEventListener('click', requestPortraitFullscreen);
  $('#addSkillBtn').addEventListener('click', addSelectedSkill);
  $('#queueForm')?.addEventListener('submit', (event) => createQueueTask(event).catch((error) => toast(error.message, 'error')));
  $('#runQueueBtn')?.addEventListener('click', () => runQueue().catch((error) => toast(error.message, 'error')));
  $('#pauseQueueBtn')?.addEventListener('click', () => pauseQueue().catch((error) => toast(error.message, 'error')));
  $('#cancelQueueBtn')?.addEventListener('click', () => cancelQueue().catch((error) => toast(error.message, 'error')));
  $('#refreshQueueBtn')?.addEventListener('click', () => loadQueue().catch((error) => toast(error.message, 'error')));
  $('#mobileConversationToggle')?.addEventListener('click', toggleMobileConversationDrawer);
  $('#mobileConversationClose')?.addEventListener('click', closeMobileConversationDrawer);
  $('#newConversationBtn').addEventListener('click', () => createConversation().catch((error) => toast(error.message, 'error')));
  $('#saveTitleBtn').addEventListener('click', () => createConversation().catch((error) => toast(error.message, 'error')));
  $('#conversationTitle').addEventListener('blur', () => saveTitle().catch((error) => toast(error.message, 'error')));
  $('#conversationTitle').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTitle().catch((error) => toast(error.message, 'error'));
      event.currentTarget.blur();
    }
  });
  $('#sendBtn').addEventListener('click', () => sendMessage().catch((error) => toast(error.message, 'error')));
  $('#regenerateBtn').addEventListener('click', regenerateLast);
  $('#clearSectionBtn').addEventListener('click', clearSection);
  $('#messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendMessage().catch((error) => toast(error.message, 'error'));
  });
  $('#previewBtn').addEventListener('click', () => refreshPreview().then(() => setTab('preview')).catch((error) => toast(error.message, 'error')));
  $('#refreshPreviewBtn').addEventListener('click', () => refreshPreview().catch((error) => toast(error.message, 'error')));
  $('#exportJsonBtn').addEventListener('click', () => exportCard(false).catch((error) => toast(error.message, 'error')));
  $('#exportPngBtn').addEventListener('click', () => exportCard(true).catch((error) => toast(error.message, 'error')));
  $('#searchImagesBtn').addEventListener('click', () => searchImages(true).catch((error) => toast(error.message, 'error')));
  $('#loadMoreImagesBtn').addEventListener('click', () => searchImages(false).catch((error) => toast(error.message, 'error')));
  $('#webSearchBtn').addEventListener('click', () => webSearch().catch((error) => toast(error.message, 'error')));
  $('#createWorkspaceBtn').addEventListener('click', () => createOrSwitchWorkspace().catch((error) => toast(error.message, 'error')));
  $('#renameWorkspaceBtn').addEventListener('click', () => renameWorkspace().catch((error) => toast(error.message, 'error')));
  $('#deleteWorkspaceBtn').addEventListener('click', () => deleteWorkspace().catch((error) => toast(error.message, 'error')));
  $('#workspaceSelect').addEventListener('change', () => switchWorkspace().catch((error) => toast(error.message, 'error')));
  $('#refreshFilesBtn').addEventListener('click', () => loadFiles().catch((error) => toast(error.message, 'error')));
  $('#newModelBtn').addEventListener('click', () => fillModelForm({}));
  $('#modelForm').addEventListener('submit', (event) => saveModel(event).catch((error) => toast(error.message, 'error')));
  $('#fetchModelsBtn').addEventListener('click', () => fetchRemoteModels().catch((error) => toast(error.message, 'error')));
  $('#remoteModelSelect').addEventListener('change', (event) => {
    if (event.target.value) $('#modelIdText').value = event.target.value;
  });
  $('#modelProviderInput').addEventListener('change', (event) => {
    if (event.target.value === 'anthropic') {
      if (!$('#modelBaseUrl').value || $('#modelBaseUrl').value.includes('deepseek')) $('#modelBaseUrl').value = 'https://api.anthropic.com/v1';
      if (!$('#modelIdText').value || $('#modelIdText').value.includes('deepseek')) $('#modelIdText').value = 'claude-sonnet-4-20250514';
    }
  });
  $('#newPromptBtn').addEventListener('click', () => fillPromptForm({ name: '新预设', messages: defaultPromptMessages() }));
  $('#addPromptMessageBtn').addEventListener('click', () => addPromptMessage({ type: $('#newPromptType').value, role: 'system', enabled: true }));
  $('#openSkillFilesBtn').addEventListener('click', () => openSkillFiles().catch((error) => toast(error.message, 'error')));
  $('#closeSkillFilesBtn').addEventListener('click', closeSkillFiles);
  $('#saveSkillFileBtn').addEventListener('click', () => saveSkillFileFromModal().catch((error) => toast(error.message, 'error')));
  $('#skillFilesModal').addEventListener('click', (event) => {
    if (event.target.id === 'skillFilesModal') closeSkillFiles();
  });
  $('#stPresetInput').addEventListener('change', (event) => importStPreset(event).catch((error) => toast(error.message, 'error')));
  $('#exportPromptBtn').addEventListener('click', exportCurrentPrompt);
  $('#promptForm').addEventListener('submit', (event) => savePrompt(event).catch((error) => toast(error.message, 'error')));
  $('#settingsForm').addEventListener('submit', (event) => saveSettings(event).catch((error) => toast(error.message, 'error')));
  $('#useDeviceRootBtn').addEventListener('click', () => useDeviceWorkspaceRoot().catch((error) => toast(error.message, 'error')));
}

async function init() {
  wireEvents();
  await Promise.all([loadHealth(), loadSettings(), loadModels(), loadPrompts(), loadSkills()]);
  await loadWorkspaces().catch((error) => toast(error.message, 'error'));
  await loadCarousel().catch((error) => toast(error.message, 'error'));
  await loadConversations();
  await loadQueue().catch((error) => toast(error.message, 'error'));
  if ((state.queue?.tasks || []).some((task) => ['queued', 'running', 'paused'].includes(task.status))) startQueuePolling();
}

init().catch((error) => toast(error.message, 'error'));

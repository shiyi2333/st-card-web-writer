const state = {
  conversations: [],
  currentConversation: null,
  models: [],
  activeModelId: null,
  prompts: [],
  activePromptId: null,
  preview: null,
  avatarDataUrl: ''
};

const sections = ['名称', '描述', '性格', '场景', '开场白', '作者备注', '标签', '绘图标签', '示例对话', '系统提示词', '备用开场白'];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(text) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 1800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
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

function setTab(name) {
  $$('.tab-button').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  $$('.panel').forEach((panel) => panel.classList.remove('active'));
  $(`#${name}Panel`)?.classList.add('active');
}

function formatDate(value) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    $('#healthLine').textContent = health.activeModel ? `${health.activeModel.name} / ${health.activePrompt || '无提示词'}` : '未配置模型';
  } catch {
    $('#healthLine').textContent = '服务未就绪';
  }
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
  list.innerHTML = '';
  state.conversations.forEach((conversation) => {
    const button = document.createElement('button');
    button.className = `conversation-item ${state.currentConversation?.id === conversation.id ? 'active' : ''}`;
    button.innerHTML = `<h3>${escapeHtml(conversation.title)}</h3><p>${conversation.messageCount} 条 / ${formatDate(conversation.updatedAt)}</p>`;
    button.addEventListener('click', () => selectConversation(conversation.id));
    list.appendChild(button);
  });
}

async function createConversation() {
  const title = $('#conversationTitle').value.trim() || '新角色卡';
  const conversation = await api('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title })
  });
  await loadConversations();
  await selectConversation(conversation.id);
}

async function selectConversation(id) {
  state.currentConversation = await api(`/api/conversations/${id}`);
  $('#conversationTitle').value = state.currentConversation.title;
  renderConversations();
  renderMessages();
  renderMessageSelect();
  await refreshPreview();
}

async function saveTitle() {
  if (!state.currentConversation) return;
  const title = $('#conversationTitle').value.trim();
  if (!title) return;
  await api(`/api/conversations/${state.currentConversation.id}`, {
    method: 'PUT',
    body: JSON.stringify({ title })
  });
  await loadConversations();
  toast('已保存标题');
}

function renderMessages() {
  const list = $('#messageList');
  list.innerHTML = '';
  if (!state.currentConversation) return;
  state.currentConversation.messages.forEach((message) => {
    const item = document.createElement('article');
    item.className = `message ${message.role}`;
    item.dataset.id = message.id;
    item.innerHTML = `
      <div class="role">
        <span>${message.role === 'assistant' ? '助手' : '用户'}</span>
        <span>${formatDate(message.createdAt)}</span>
      </div>
      <pre>${escapeHtml(message.content)}</pre>
    `;
    if (message.role === 'assistant') {
      item.addEventListener('click', async () => {
        $('#messageSelect').value = message.id;
        setTab('preview');
        await refreshPreview();
      });
    }
    list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
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

async function sendMessage() {
  if (!state.currentConversation) {
    await createConversation();
  }
  const input = $('#messageInput');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  const tempUser = { id: `tmp_${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() };
  const tempAssistant = { id: `stream_${Date.now()}`, role: 'assistant', content: '', createdAt: new Date().toISOString() };
  state.currentConversation.messages.push(tempUser, tempAssistant);
  renderMessages();

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: state.currentConversation.id, message: content })
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
      if (payload.token) {
        tempAssistant.content += payload.token;
        renderMessages();
      }
      if (payload.done && payload.message) {
        await selectConversation(state.currentConversation.id);
      }
    }
  }
  await loadConversations();
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
  const statItems = [
    `标题: ${state.preview.stats.title || '未识别'}`,
    `标签: ${state.preview.stats.tagCount}`,
    `绘图: ${state.preview.stats.drawingTagCount}`,
    `开场: ${state.preview.stats.openingChars}`,
    `状态栏: ${state.preview.stats.hasStatusBar ? '有' : '无'}`
  ];
  statItems.forEach((item) => {
    const pill = document.createElement('span');
    pill.className = 'stat-pill';
    pill.textContent = item;
    stats.appendChild(pill);
  });

  sections.forEach((name) => {
    if (!state.preview.sections[name]) return;
    const card = document.createElement('button');
    card.className = 'section-card';
    card.innerHTML = `<h3>${name}</h3><pre>${escapeHtml(state.preview.sections[name])}</pre>`;
    card.addEventListener('click', () => insertSectionMarker(name));
    grid.appendChild(card);
  });
  json.textContent = JSON.stringify(state.preview.json, null, 2);
}

function insertSectionMarker(name) {
  const input = $('#messageInput');
  const current = input.value.trim();
  const marker = `[修改:${name}]\n请只重写这个部分，并保持完整角色卡结构。`;
  input.value = current ? `${current}\n\n${marker}` : marker;
  setTab('chat');
  input.focus();
}

async function exportCard(withPng) {
  if (!state.currentConversation) return;
  if (withPng && !state.avatarDataUrl) {
    toast('请先选择 PNG 底图');
    return;
  }
  const result = await api('/api/cards/export', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: state.currentConversation.id,
      messageId: $('#messageSelect').value || undefined,
      avatarDataUrl: withPng ? state.avatarDataUrl : ''
    })
  });
  const links = [
    `<a href="${result.json}" target="_blank">JSON</a>`,
    `<a href="${result.markdown}" target="_blank">Markdown</a>`,
    result.png ? `<a href="${result.png}" target="_blank">PNG</a>` : ''
  ].filter(Boolean).join('');
  $('#exportResult').innerHTML = links;
  state.preview = result.preview;
  renderPreview();
  toast('已导出');
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
    button.innerHTML = `<h3>${escapeHtml(model.name)}</h3><p>${escapeHtml(model.model)} / ${escapeHtml(model.apiKey || '未保存 key')}</p>`;
    button.addEventListener('click', () => fillModelForm(model));
    list.appendChild(button);
  });
  const active = state.models.find((model) => model.id === state.activeModelId) || state.models[0];
  if (active) fillModelForm(active);
}

function fillModelForm(model = {}) {
  $('#modelId').value = model.id || '';
  $('#modelName').value = model.name || '';
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
    baseUrl: $('#modelBaseUrl').value.trim(),
    model: $('#modelIdText').value.trim(),
    temperature: Number($('#modelTemperature').value || 0.8)
  };
  const key = $('#modelApiKey').value;
  if (key) body.apiKey = key;
  if (!idValue) body.apiKey = key;
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
    baseUrl: $('#modelBaseUrl').value.trim(),
    apiKey: $('#modelApiKey').value,
    model: $('#modelIdText').value.trim()
  };
  if (!body.apiKey && $('#modelId').value) body.id = $('#modelId').value;
  const payload = await api('/api/models/fetch', {
    method: 'POST',
    body: JSON.stringify(body)
  });
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
    button.innerHTML = `<h3>${escapeHtml(prompt.name)}</h3><p>${formatDate(prompt.updatedAt)}</p>`;
    button.addEventListener('click', () => fillPromptForm(prompt));
    list.appendChild(button);
  });
  const active = state.prompts.find((prompt) => prompt.id === state.activePromptId) || state.prompts[0];
  if (active) fillPromptForm(active);
}

function fillPromptForm(prompt = {}) {
  $('#promptId').value = prompt.id || '';
  $('#promptName').value = prompt.name || '';
  $('#promptSystem').value = prompt.system || '';
  $('#promptRewrite').value = prompt.rewrite || '';
}

async function savePrompt(event) {
  event.preventDefault();
  const idValue = $('#promptId').value;
  const body = {
    name: $('#promptName').value.trim(),
    system: $('#promptSystem').value,
    rewrite: $('#promptRewrite').value
  };
  const saved = idValue
    ? await api(`/api/prompts/${idValue}`, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/api/prompts', { method: 'POST', body: JSON.stringify(body) });
  const activeId = saved.prompt?.id || idValue;
  await api(`/api/prompts/${activeId}/activate`, { method: 'POST' });
  await loadPrompts();
  await loadHealth();
  toast('提示词已保存');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function wireEvents() {
  $$('.tab-button').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $('#newConversationBtn').addEventListener('click', createConversation);
  $('#saveTitleBtn').addEventListener('click', saveTitle);
  $('#sendBtn').addEventListener('click', () => sendMessage().catch((error) => toast(error.message)));
  $('#messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      sendMessage().catch((error) => toast(error.message));
    }
  });
  $('#previewBtn').addEventListener('click', () => refreshPreview().then(() => setTab('preview')).catch((error) => toast(error.message)));
  $('#refreshPreviewBtn').addEventListener('click', () => refreshPreview().catch((error) => toast(error.message)));
  $('#exportJsonBtn').addEventListener('click', () => exportCard(false).catch((error) => toast(error.message)));
  $('#exportPngBtn').addEventListener('click', () => exportCard(true).catch((error) => toast(error.message)));
  $('#avatarInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.type !== 'image/png') {
      toast('只支持 PNG');
      return;
    }
    state.avatarDataUrl = await fileToDataUrl(file);
    toast('底图已载入');
  });
  $('#newModelBtn').addEventListener('click', () => fillModelForm({}));
  $('#modelForm').addEventListener('submit', (event) => saveModel(event).catch((error) => toast(error.message)));
  $('#fetchModelsBtn').addEventListener('click', () => fetchRemoteModels().catch((error) => toast(error.message)));
  $('#remoteModelSelect').addEventListener('change', (event) => {
    if (event.target.value) $('#modelIdText').value = event.target.value;
  });
  $('#newPromptBtn').addEventListener('click', () => fillPromptForm({}));
  $('#promptForm').addEventListener('submit', (event) => savePrompt(event).catch((error) => toast(error.message)));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function init() {
  wireEvents();
  await Promise.all([loadHealth(), loadModels(), loadPrompts(), loadConversations()]);
}

init().catch((error) => toast(error.message));

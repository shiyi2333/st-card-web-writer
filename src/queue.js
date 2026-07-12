import { EventEmitter } from 'node:events';

export const QUEUE_MODES = new Set(['direct', 'outline']);
const ACTIVE_TASK_STATUSES = new Set(['queued', 'paused', 'running', 'draft_ready']);
const RUNNABLE_TASK_STATUSES = new Set(['queued', 'paused', 'running']);

export function normalizeQueueMode(value) {
  return QUEUE_MODES.has(value) ? value : 'outline';
}

export class CardQueue extends EventEmitter {
  constructor({ id, now, store, chatText, exportCard, makeConversation, validateCard, repairPrompt }) {
    super();
    this.id = id;
    this.now = now;
    this.store = store;
    this.chatText = chatText;
    this.exportCard = exportCard;
    this.makeConversation = makeConversation;
    this.validateCard = validateCard;
    this.repairPrompt = repairPrompt;
    this.running = false;
    this.paused = false;
    this.cancelled = false;
    this.currentPromise = null;
  }

  snapshot() {
    return structuredClone(this.store.data.cardQueue || { tasks: [] });
  }

  task(taskId) {
    return (this.store.data.cardQueue?.tasks || []).find((item) => item.id === taskId) || null;
  }

  async createTask(input = {}) {
    const now = this.now();
    const mode = 'outline';
    const count = Math.max(1, Math.min(Number(input.count) || 1, 20));
    const task = {
      id: this.id('queue'),
      title: String(input.title || '').trim() || '设定展开队列',
      mode,
      seedText: String(input.seedText || input.itemsText || '').trim(),
      itemsText: String(input.itemsText || '').trim(),
      count,
      autoExport: input.autoExport !== false,
      reviewBeforeRun: false,
      status: 'queued',
      activeIndex: -1,
      createdAt: now,
      updatedAt: now,
      items: [],
      logs: []
    };
    await this.store.mutate((data) => {
      data.cardQueue ||= { tasks: [] };
      data.cardQueue.tasks.unshift(task);
      data.cardQueue.tasks = data.cardQueue.tasks.slice(0, 40);
    });
    this.emit('change');
    return task;
  }

  makeItem(text, index, now = this.now()) {
    return {
      id: this.id('qitem'),
      title: text.slice(0, 48) || `角色 ${index + 1}`,
      brief: text,
      status: 'queued',
      retries: 0,
      createdAt: now,
      updatedAt: now,
      markdown: '',
      conversationId: '',
      exportResult: null,
      validation: null,
      error: ''
    };
  }

  async updateTask(taskId, patch = {}) {
    const allowed = new Set(['title', 'seedText', 'itemsText', 'count', 'autoExport']);
    await this.store.mutate((data) => {
      const task = (data.cardQueue?.tasks || []).find((item) => item.id === taskId);
      if (!task) return;
      for (const [key, value] of Object.entries(patch)) {
        if (!allowed.has(key)) continue;
        task[key] = key === 'count' ? Math.max(1, Math.min(Number(value) || task.count || 1, 20)) : value;
      }
      task.updatedAt = this.now();
    });
    this.emit('change');
    return this.task(taskId);
  }

  async updateItem(taskId, itemId, patch = {}) {
    const allowed = new Set(['title', 'brief', 'status']);
    await this.store.mutate((data) => {
      const task = (data.cardQueue?.tasks || []).find((item) => item.id === taskId);
      const item = task?.items?.find((entry) => entry.id === itemId);
      if (!item) return;
      for (const [key, value] of Object.entries(patch)) {
        if (allowed.has(key)) item[key] = value;
      }
      item.updatedAt = this.now();
      task.updatedAt = item.updatedAt;
    });
    this.emit('change');
    return this.task(taskId);
  }

  async pause() {
    this.paused = true;
    await this.markRunningTasks('paused');
  }

  async resume(taskId = '') {
    this.paused = false;
    await this.releaseDraft(taskId);
    if (!this.running) this.currentPromise = this.run(taskId);
    return this.currentPromise;
  }

  async releaseDraft(taskId = '') {
    await this.store.mutate((data) => {
      for (const task of data.cardQueue?.tasks || []) {
        if (taskId && task.id !== taskId) continue;
        if (task.status !== 'draft_ready') continue;
        task.status = 'queued';
        task.updatedAt = this.now();
      }
    });
    this.emit('change');
  }

  async cancel(taskId = '') {
    this.cancelled = true;
    await this.store.mutate((data) => {
      for (const task of data.cardQueue?.tasks || []) {
        if (taskId && task.id !== taskId) continue;
        if (ACTIVE_TASK_STATUSES.has(task.status)) {
          task.status = 'cancelled';
          task.updatedAt = this.now();
        }
        for (const item of task.items || []) {
          if (['queued', 'running'].includes(item.status)) {
            item.status = 'cancelled';
            item.updatedAt = task.updatedAt;
          }
        }
      }
    });
    this.emit('change');
  }

  async retry(taskId, itemId = '') {
    await this.store.mutate((data) => {
      const task = (data.cardQueue?.tasks || []).find((item) => item.id === taskId);
      if (!task) return;
      task.status = 'queued';
      task.updatedAt = this.now();
      for (const item of task.items || []) {
        if (itemId && item.id !== itemId) continue;
        if (['failed', 'cancelled'].includes(item.status)) {
          item.status = 'queued';
          item.error = '';
          item.validation = null;
          item.updatedAt = task.updatedAt;
        }
      }
    });
    this.paused = false;
    this.cancelled = false;
    if (!this.running) this.currentPromise = this.run(taskId);
    this.emit('change');
    return this.currentPromise;
  }

  async markRunningTasks(status) {
    await this.store.mutate((data) => {
      for (const task of data.cardQueue?.tasks || []) {
        if (task.status === 'running') {
          task.status = status;
          task.updatedAt = this.now();
        }
      }
    });
    this.emit('change');
  }

  async run(taskId = '') {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    try {
      while (!this.paused && !this.cancelled) {
        const task = this.nextTask(taskId);
        if (!task) break;
        await this.runTask(task.id);
        if (taskId) break;
      }
    } finally {
      this.running = false;
      this.emit('change');
    }
  }

  nextTask(taskId = '') {
    const tasks = this.store.data.cardQueue?.tasks || [];
    return tasks
      .slice()
      .reverse()
      .find((task) => (!taskId || task.id === taskId) && RUNNABLE_TASK_STATUSES.has(task.status));
  }

  async runTask(taskId) {
    const task = this.task(taskId);
    if (!task) return;
    if (task.mode === 'outline' && !task.items.length) {
      await this.expandOutlineTask(taskId);
      const expanded = this.task(taskId);
      if (expanded?.reviewBeforeRun === true) {
        await this.setTaskStatus(taskId, 'draft_ready');
        return;
      }
    }
    await this.setTaskStatus(taskId, 'running');
    while (!this.paused && !this.cancelled) {
      const current = this.task(taskId);
      const nextIndex = current?.items?.findIndex((item) => item.status === 'queued');
      if (nextIndex === undefined || nextIndex < 0) break;
      await this.runItem(taskId, nextIndex);
    }
    const latest = this.task(taskId);
    if (!latest) return;
    const statuses = latest.items.map((item) => item.status);
    const nextStatus = this.cancelled
      ? 'cancelled'
      : this.paused
        ? 'paused'
        : statuses.some((status) => status === 'failed')
          ? 'failed'
          : 'done';
    await this.setTaskStatus(taskId, nextStatus);
  }

  async expandOutlineTask(taskId) {
    const task = this.task(taskId);
    const prompt = [
      `请基于下面需求列出 ${task.count} 个简洁角色卡设定。`,
      '只输出 JSON 数组，每项包含 title 和 brief 字段，不要 Markdown，不要解释。',
      task.seedText || task.itemsText
    ].join('\n\n');
    const text = await this.chatText(prompt);
    let parsed = [];
    try {
      const jsonText = text.match(/```json\s*([\s\S]*?)```/i)?.[1] || text.match(/\[[\s\S]*\]/)?.[0] || text;
      parsed = JSON.parse(jsonText);
    } catch {
      parsed = String(text).split(/\r?\n/).map((line) => ({ title: line.replace(/^[-\d.\s]+/, '').slice(0, 40), brief: line.replace(/^[-\d.\s]+/, '') })).filter((item) => item.brief);
    }
    const now = this.now();
    const items = parsed.slice(0, task.count).map((item, index) => this.makeItem(`${item.title || ''}${item.brief ? `：${item.brief}` : ''}`, index, now));
    await this.store.mutate((data) => {
      const target = (data.cardQueue?.tasks || []).find((item) => item.id === taskId);
      if (!target) return;
      target.items = items.length ? items : [this.makeItem(task.seedText || '新角色卡', 0, now)];
      target.updatedAt = now;
      target.logs ||= [];
      target.logs.push({ at: now, message: `已生成 ${target.items.length} 个简洁设定` });
    });
    this.emit('change');
  }

  async runItem(taskId, index) {
    await this.store.mutate((data) => {
      const task = (data.cardQueue?.tasks || []).find((item) => item.id === taskId);
      const item = task?.items?.[index];
      if (!item) return;
      task.activeIndex = index;
      task.status = 'running';
      item.status = 'running';
      item.updatedAt = task.updatedAt = this.now();
    });
    this.emit('change');
    const task = this.task(taskId);
    const item = task.items[index];
    try {
      const markdown = await this.chatText(this.cardPrompt(task, item, index));
      let finalMarkdown = markdown;
      let validation = this.validateCard?.(finalMarkdown) || null;
      if (validation?.status === 'error' && this.repairPrompt) {
        const repaired = await this.chatText(this.repairPrompt(finalMarkdown, validation));
        const repairedValidation = this.validateCard?.(repaired) || null;
        if (repairedValidation && repairedValidation.status !== 'error') {
          finalMarkdown = repaired;
          validation = repairedValidation;
        }
      }
      const conversationId = await this.makeConversation({
        title: item.title || `队列角色 ${index + 1}`,
        userText: item.brief,
        assistantText: finalMarkdown
      });
      const exportResult = task.autoExport ? await this.exportCard({ markdown: finalMarkdown, conversationId, taskId, itemId: item.id, validation }) : null;
      await this.store.mutate((data) => {
        const current = (data.cardQueue?.tasks || []).find((entry) => entry.id === taskId);
        const currentItem = current?.items?.[index];
        if (!currentItem) return;
        currentItem.status = 'done';
        currentItem.markdown = finalMarkdown;
        currentItem.conversationId = conversationId;
        currentItem.exportResult = exportResult;
        currentItem.validation = validation;
        currentItem.error = '';
        currentItem.updatedAt = current.updatedAt = this.now();
      });
    } catch (error) {
      await this.store.mutate((data) => {
        const current = (data.cardQueue?.tasks || []).find((entry) => entry.id === taskId);
        const currentItem = current?.items?.[index];
        if (!currentItem) return;
        currentItem.status = 'failed';
        currentItem.retries += 1;
        currentItem.error = error.message;
        currentItem.updatedAt = current.updatedAt = this.now();
      });
    }
    this.emit('change');
  }

  cardPrompt(task, item, index) {
    return [
      '请把下面简洁设定完善成完整 SillyTavern 角色卡 Markdown。',
      '必须使用这些一级标题：# 名称、# 描述、# 性格、# 场景、# 开场白、# 作者备注、# 标签、# 绘图标签。',
      '描述部分优先写成可解析的结构化 YAML 代码块；绘图标签使用 Danbooru 英文 tag；开场白写成一段可直接作为 first message 的中文内容。',
      `这是队列任务 ${task.title} 的第 ${index + 1} 张卡。`,
      item.brief
    ].join('\n\n');
  }

  async setTaskStatus(taskId, status) {
    await this.store.mutate((data) => {
      const task = (data.cardQueue?.tasks || []).find((item) => item.id === taskId);
      if (!task) return;
      task.status = status;
      task.updatedAt = this.now();
    });
    this.emit('change');
  }
}

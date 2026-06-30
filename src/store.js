import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const STORE_VERSION = 3;

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function maskKey(value = '') {
  if (!value) return '';
  if (value.length <= 12) return `${value.slice(0, 3)}...`;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  async init(defaultData) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch {
      this.data = defaultData;
      await this.save();
    }
    this.data.version ||= STORE_VERSION;
    this.data.settings ||= {};
    this.data.usedImages ||= { global: [], workspaces: {} };
    this.data.usedImages.global ||= [];
    this.data.usedImages.workspaces ||= {};
    this.data.imageCache ||= [];
    this.data.models ||= [];
    this.data.activeModelId ||= null;
    this.data.prompts ||= [];
    this.data.activePromptId ||= null;
    this.data.conversations ||= [];
    await this.save();
  }

  snapshot() {
    return structuredClone(this.data);
  }

  async save() {
    const payload = JSON.stringify(this.data, null, 2);
    this.writeQueue = this.writeQueue.then(() => fs.writeFile(this.filePath, `${payload}\n`, 'utf8'));
    return this.writeQueue;
  }

  async mutate(fn) {
    const result = fn(this.data);
    await this.save();
    return result;
  }
}

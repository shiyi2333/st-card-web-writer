import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureWorkspace, safeFileName } from './workspace.js';

const INDEX_FILE = '.st-card-index.json';

function indexPath(workspace) {
  return path.join(workspace.dir, INDEX_FILE);
}

function cleanRecord(record = {}) {
  const now = new Date().toISOString();
  const name = String(record.name || 'character').trim() || 'character';
  return {
    id: String(record.id || `${safeFileName(name, 'character')}_${Date.now()}`),
    name,
    source: String(record.source || 'manual'),
    taskId: String(record.taskId || ''),
    itemId: String(record.itemId || ''),
    conversationId: String(record.conversationId || ''),
    json: String(record.json || ''),
    markdown: String(record.markdown || ''),
    png: String(record.png || ''),
    validationStatus: String(record.validation?.status || record.validationStatus || ''),
    validationIssues: Array.isArray(record.validation?.issues)
      ? record.validation.issues.slice(0, 12)
      : Array.isArray(record.validationIssues)
        ? record.validationIssues.slice(0, 12)
        : [],
    createdAt: String(record.createdAt || now),
    updatedAt: String(record.updatedAt || now)
  };
}

async function readRawIndex(workspace) {
  try {
    const source = await fs.readFile(indexPath(workspace), 'utf8');
    const parsed = JSON.parse(source);
    return {
      version: 1,
      workspace: workspace.name,
      cards: Array.isArray(parsed.cards) ? parsed.cards.map(cleanRecord) : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, workspace: workspace.name, cards: [] };
    throw error;
  }
}

export async function readWorkspaceIndex(settings = {}) {
  const workspace = await ensureWorkspace(settings);
  const index = await readRawIndex(workspace);
  index.workspace = workspace.name;
  return index;
}

export async function recordWorkspaceCard(settings = {}, record = {}) {
  const workspace = await ensureWorkspace(settings);
  const index = await readRawIndex(workspace);
  const next = cleanRecord(record);
  const key = next.id || next.markdown || next.json;
  const existing = index.cards.findIndex((item) => item.id === key || item.markdown === next.markdown || item.json === next.json);
  if (existing >= 0) {
    next.createdAt = index.cards[existing].createdAt || next.createdAt;
    index.cards.splice(existing, 1);
  }
  index.cards.unshift(next);
  index.cards = index.cards.slice(0, 500);
  await fs.writeFile(indexPath(workspace), JSON.stringify(index, null, 2), 'utf8');
  return { ...index, workspace: workspace.name };
}

export async function removeWorkspaceIndexSidecars(settings = {}, removedNames = []) {
  const removed = new Set((removedNames || []).map(String));
  if (!removed.size) return readWorkspaceIndex(settings);
  const workspace = await ensureWorkspace(settings);
  const index = await readRawIndex(workspace);
  let changed = false;
  for (const card of index.cards) {
    let cardChanged = false;
    if (card.json && removed.has(card.json)) {
      card.json = '';
      cardChanged = true;
    }
    if (card.markdown && removed.has(card.markdown)) {
      card.markdown = '';
      cardChanged = true;
    }
    if (cardChanged) {
      card.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await fs.writeFile(indexPath(workspace), JSON.stringify(index, null, 2), 'utf8');
  return { ...index, workspace: workspace.name };
}

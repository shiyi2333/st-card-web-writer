import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureInside, ensureWorkspace, safeFileName } from './workspace.js';
import { makeCardJson, parseMarkdownCard } from './card.js';
import { dataUrlToBuffer, embedCardInPng, readCardJsonFromPng } from './png.js';

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

function cleanTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,，\s\n]+/);
  return [...new Set(source.map((item) => String(item).trim()).filter(Boolean))].slice(0, 32);
}

function cardDetails(card = {}) {
  const data = card.data || card;
  const extensions = data.extensions || {};
  return {
    name: String(data.name || card.name || '未命名角色卡').trim() || '未命名角色卡',
    summary: String(data.creator_notes || card.creatorcomment || data.description || card.description || '').trim(),
    drawingTags: cleanTags(extensions.danbooru_tags || card.danbooru_tags)
  };
}

async function readArtifactCard(filePath, extension) {
  if (extension === '.png') return readCardJsonFromPng(await fs.readFile(filePath));
  if (extension === '.json') {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!parsed?.data?.name && !parsed?.name) throw new Error('不是角色卡 JSON');
    return parsed;
  }
  if (extension === '.md') {
    const markdown = await fs.readFile(filePath, 'utf8');
    const sections = parseMarkdownCard(markdown);
    if (!sections['名称']) throw new Error('不是角色卡 Markdown');
    return makeCardJson(markdown);
  }
  throw new Error('不支持的角色卡格式');
}

function artifactNames(record = {}) {
  return [record.png, record.json, record.markdown].filter(Boolean);
}

export async function readWorkspaceCatalog(settings = {}) {
  const workspace = await ensureWorkspace(settings);
  const index = await readRawIndex(workspace);
  const entries = await fs.readdir(workspace.dir, { withFileTypes: true });
  const files = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (!['.png', '.json', '.md'].includes(extension) || entry.name === INDEX_FILE) continue;
    const fullPath = path.join(workspace.dir, entry.name);
    const stat = await fs.stat(fullPath);
    files.set(entry.name, { name: entry.name, extension, fullPath, stat });
  }

  const referenced = new Set();
  const cards = [];
  for (const record of index.cards) {
    const candidates = artifactNames(record).map((name) => files.get(name)).filter(Boolean);
    artifactNames(record).forEach((name) => referenced.add(name));
    let details = null;
    for (const candidate of candidates) {
      try {
        details = cardDetails(await readArtifactCard(candidate.fullPath, candidate.extension));
        break;
      } catch {
        // Try the next sidecar when one artifact is malformed or unavailable.
      }
    }
    if (!details && !candidates.length) continue;
    cards.push({
      ...record,
      ...(details || { name: record.name, summary: '', drawingTags: [] }),
      exportedAt: record.createdAt || candidates[0]?.stat.birthtime?.toISOString() || candidates[0]?.stat.mtime?.toISOString(),
      coverUpdatedAt: candidates.find((item) => item.extension === '.png')?.stat.mtime?.toISOString() || ''
    });
  }

  const orphanGroups = new Map();
  for (const file of files.values()) {
    if (referenced.has(file.name)) continue;
    const stem = path.basename(file.name, file.extension);
    const group = orphanGroups.get(stem) || [];
    group.push(file);
    orphanGroups.set(stem, group);
  }

  for (const [stem, group] of orphanGroups) {
    const candidates = [...group].sort((a, b) => ['.png', '.json', '.md'].indexOf(a.extension) - ['.png', '.json', '.md'].indexOf(b.extension));
    let details = null;
    for (const candidate of candidates) {
      try {
        details = cardDetails(await readArtifactCard(candidate.fullPath, candidate.extension));
        break;
      } catch {
        // Ignore unrelated or malformed files in the workspace.
      }
    }
    if (!details) continue;
    const exportedAt = candidates.reduce((earliest, candidate) => {
      const value = candidate.stat.birthtimeMs > 0 ? candidate.stat.birthtime : candidate.stat.mtime;
      return !earliest || value < earliest ? value : earliest;
    }, null)?.toISOString();
    cards.push({
      id: `file_${stem}`,
      ...details,
      source: 'workspace',
      png: candidates.find((item) => item.extension === '.png')?.name || '',
      json: candidates.find((item) => item.extension === '.json')?.name || '',
      markdown: candidates.find((item) => item.extension === '.md')?.name || '',
      coverUpdatedAt: candidates.find((item) => item.extension === '.png')?.stat.mtime?.toISOString() || '',
      exportedAt,
      createdAt: exportedAt,
      updatedAt: exportedAt
    });
  }

  cards.sort((a, b) => new Date(a.exportedAt || 0) - new Date(b.exportedAt || 0));
  return { workspace: workspace.name, cards };
}

export async function replaceWorkspaceCardCover(settings = {}, input = {}) {
  const workspace = await ensureWorkspace(settings);
  const fileName = safeFileName(input.fileName || '');
  if (!fileName || path.extname(fileName).toLowerCase() !== '.png') {
    const error = new Error('只能替换当前工作区中的角色卡 PNG');
    error.status = 400;
    throw error;
  }

  const target = ensureInside(workspace.root, path.join(workspace.dir, fileName));
  const currentPng = await fs.readFile(target);
  const cardJson = readCardJsonFromPng(currentPng);
  const avatar = dataUrlToBuffer(input.avatarDataUrl);
  if (avatar.length > 20 * 1024 * 1024) {
    const error = new Error('封面 PNG 不能超过 20 MB');
    error.status = 413;
    throw error;
  }

  const output = embedCardInPng(avatar, cardJson);
  await fs.writeFile(target, output);
  return {
    ok: true,
    workspace: workspace.name,
    fileName,
    name: cardJson?.data?.name || cardJson?.name || fileName
  };
}

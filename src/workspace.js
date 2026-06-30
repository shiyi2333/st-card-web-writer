import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const INVALID_NAME = /[<>:"/\\|?*\x00-\x1F]/g;

export function safeFileName(value, fallback = 'item') {
  return String(value || fallback)
    .replace(INVALID_NAME, '_')
    .replace(/[. ]+$/g, '')
    .trim() || fallback;
}

export function defaultWorkspaceRoot() {
  if (process.platform === 'win32') return 'G:\\角色卡';

  const home = os.homedir();
  const candidates = [
    [path.join(home, 'storage', 'downloads'), path.join(home, 'storage', 'downloads', '角色卡')],
    [path.join(home, 'storage', 'shared', 'Download'), path.join(home, 'storage', 'shared', 'Download', '角色卡')],
    [path.join(home, 'Downloads'), path.join(home, 'Downloads', '角色卡')]
  ];
  const found = candidates.find(([base]) => fsSync.existsSync(base));
  return found ? found[1] : path.join(home, '角色卡');
}

export function workspaceRoot(settings = {}) {
  return path.resolve(settings.workspaceRoot || defaultWorkspaceRoot());
}

export function ensureInside(root, target) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('路径超出当前角色卡根目录');
    error.status = 400;
    throw error;
  }
  return targetPath;
}

export function resolveWorkspace(settings = {}, workspaceName = settings.currentWorkspace) {
  const root = workspaceRoot(settings);
  const name = safeFileName(workspaceName || '默认工作区', '默认工作区');
  return {
    root,
    name,
    dir: ensureInside(root, path.join(root, name)),
    tempDir: ensureInside(root, path.join(root, name, 'temp'))
  };
}

export async function ensureWorkspace(settings = {}) {
  const workspace = resolveWorkspace(settings);
  await fs.mkdir(workspace.dir, { recursive: true });
  await fs.mkdir(workspace.tempDir, { recursive: true });
  return workspace;
}

export async function listWorkspaces(settings = {}) {
  const root = workspaceRoot(settings);
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function listWorkspaceFiles(settings = {}) {
  const workspace = await ensureWorkspace(settings);
  const entries = await fs.readdir(workspace.dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(workspace.dir, entry.name);
    const stat = await fs.stat(fullPath);
    files.push({
      name: entry.name,
      type: entry.isDirectory() ? 'dir' : 'file',
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      isTemp: entry.name === 'temp',
      download: entry.isFile() ? `/api/workspaces/file?name=${encodeURIComponent(entry.name)}` : ''
    });
  }
  return files.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export async function writeWorkspaceArtifact(settings, fileName, content, options = {}) {
  const workspace = await ensureWorkspace(settings);
  const dir = options.temp ? workspace.tempDir : workspace.dir;
  const target = ensureInside(workspace.root, path.join(dir, safeFileName(fileName)));
  await fs.writeFile(target, content);
  return target;
}

export async function removeWorkspaceItem(settings, name) {
  const workspace = await ensureWorkspace(settings);
  const target = ensureInside(workspace.root, path.join(workspace.dir, safeFileName(name)));
  if (target === workspace.dir || target === workspace.tempDir) {
    const error = new Error('不能删除当前工作区或 temp 目录');
    error.status = 400;
    throw error;
  }
  await fs.rm(target, { recursive: true, force: true });
}

export async function renameWorkspaceItem(settings, from, to) {
  const workspace = await ensureWorkspace(settings);
  const source = ensureInside(workspace.root, path.join(workspace.dir, safeFileName(from)));
  const target = ensureInside(workspace.root, path.join(workspace.dir, safeFileName(to)));
  await fs.rename(source, target);
}

export async function moveWorkspaceItem(settings, fromWorkspace, itemName, toWorkspace) {
  const root = workspaceRoot(settings);
  const source = ensureInside(root, path.join(root, safeFileName(fromWorkspace), safeFileName(itemName)));
  const targetDir = ensureInside(root, path.join(root, safeFileName(toWorkspace)));
  await fs.mkdir(targetDir, { recursive: true });
  await fs.rename(source, ensureInside(root, path.join(targetDir, safeFileName(itemName))));
}

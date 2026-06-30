const DANBOORU_URL = 'https://danbooru.donmai.us/posts.json';
const BLOCKED_TAGS = new Set(['loli', 'shota', 'young', 'child', 'underage']);

function splitTags(tags = '') {
  return String(tags)
    .split(/[\s,，]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function normalizeImageTags(tags = '') {
  const raw = splitTags(tags);
  const normalized = [];
  const push = (tag) => {
    const clean = String(tag || '').trim().replace(/\s+/g, '_');
    if (!clean || BLOCKED_TAGS.has(clean) || normalized.includes(clean)) return;
    normalized.push(clean);
  };

  raw.forEach(push);
  if (!normalized.some((tag) => /^1(girl|boy)$/.test(tag))) push('1girl');
  if (!normalized.includes('solo')) push('solo');
  if (!normalized.includes('t-shirt') && !normalized.some((tag) => /dress|shirt|skirt|uniform|bikini|sweater|kimono|jacket/.test(tag))) {
    push('t-shirt');
  }
  if (!normalized.some((tag) => /breasts|cleavage|nsfw|nude|sex/.test(tag))) {
    push('huge_breasts');
  }
  return normalized.slice(0, 12);
}

function normalizePost(post) {
  return {
    id: post.id,
    rating: post.rating,
    score: post.score,
    width: post.image_width,
    height: post.image_height,
    previewUrl: post.preview_file_url,
    sampleUrl: post.large_file_url || post.file_url || post.preview_file_url,
    fileUrl: post.file_url || post.large_file_url || post.preview_file_url,
    source: post.source || '',
    tags: String(post.tag_string || '').split(' ').slice(0, 36),
    postUrl: `https://danbooru.donmai.us/posts/${post.id}`
  };
}

export async function searchDanbooru({ tags = '', limit = 10, usedIds = [], page = 1, offset = 0, includeUsed = false }) {
  const count = Number(limit) === 5 ? 5 : 10;
  const normalized = normalizeImageTags(tags);
  const used = new Set((usedIds || []).map(String));
  const queryTags = normalized.slice(0, 2);
  const pageNumber = Math.max(1, Number(page || 1));
  const extraOffset = Math.max(0, Number(offset || 0));
  const fetchLimit = Math.min(100, count * 8 + extraOffset);
  const params = new URLSearchParams({
    tags: `${queryTags.join(' ')} rating:e`,
    limit: String(fetchLimit),
    page: String(pageNumber)
  });
  const response = await fetch(`${DANBOORU_URL}?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'st-card-web-writer/1.0' }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Danbooru 搜图失败: ${response.status} ${detail.slice(0, 160)}`);
  }
  const posts = await response.json();
  const filtered = posts
    .filter((post) => post.file_url || post.large_file_url || post.preview_file_url)
    .filter((post) => includeUsed || !used.has(String(post.id)))
    .slice(extraOffset)
    .map(normalizePost)
    .slice(0, count);

  return {
    tags: normalized,
    queryTags,
    page: pageNumber,
    offset: extraOffset,
    next: {
      page: pageNumber + 1,
      offset: 0
    },
    results: filtered
  };
}

export async function tavilySearch({ apiKey, query, maxResults = 5 }) {
  if (!apiKey) {
    const error = new Error('请先在设置里保存 Tavily API Key');
    error.status = 400;
    throw error;
  }
  if (!query) {
    const error = new Error('搜索词不能为空');
    error.status = 400;
    throw error;
  }
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: true,
      include_images: false,
      max_results: Math.max(1, Math.min(Number(maxResults) || 5, 10))
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Tavily 搜索失败: ${response.status} ${detail.slice(0, 200)}`);
  }
  const payload = await response.json();
  return {
    answer: payload.answer || '',
    results: (payload.results || []).map((item) => ({
      title: item.title || item.url,
      url: item.url,
      content: item.content || '',
      score: item.score ?? null
    }))
  };
}

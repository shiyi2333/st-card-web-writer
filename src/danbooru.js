const DANBOORU_POSTS_URL = 'https://danbooru.donmai.us/posts.json';
const DANBOORU_TAGS_URL = 'https://danbooru.donmai.us/tags.json';
const USER_AGENT = 'st-card-web-writer/1.0';
const BLOCKED_TAGS = new Set(['loli', 'shota', 'young', 'child', 'underage']);
const TAG_CACHE = new Map();

const KNOWN_PHRASES = new Set([
  'black hair', 'white hair', 'silver hair', 'blonde hair', 'brown hair',
  'red hair', 'blue hair', 'green hair', 'pink hair', 'purple hair',
  'long hair', 'short hair', 'medium hair', 'black eyes', 'blue eyes',
  'red eyes', 'brown eyes', 'green eyes', 'yellow eyes', 'huge breasts',
  'large breasts', 'medium breasts', 'small breasts', 'office lady',
  'black pantyhose', 'white shirt', 'black shirt', 'black skirt',
  'school uniform', 'looking at viewer', 'mature female', 'solo focus'
]);

const TAG_PRIORITY = [
  /_(costume|uniform|dress|shirt|skirt|pantyhose|thighhighs|bikini|kimono|jacket)$/,
  /(office_lady|school_uniform|maid|nurse|teacher|secretary)/,
  /(classroom|office|bedroom|indoors|outdoors|beach|street)/,
  /(black_hair|white_hair|long_hair|short_hair|ponytail|twintails)/,
  /(huge_breasts|large_breasts|mature_female|wide_hips)/,
  /^1(girl|boy)$/
];

function baseHeaders() {
  return { Accept: 'application/json', 'User-Agent': USER_AGENT };
}

function cleanTag(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_:+-]/g, '')
    .replace(/^_+|_+$/g, '');
}

function splitTags(tags = '') {
  const value = String(tags || '').replace(/[，、；;]/g, ',');
  const commaParts = value.split(',').map((part) => part.trim()).filter(Boolean);
  const tokens = [];
  for (const part of commaParts.length ? commaParts : [value]) {
    const words = part.split(/\s+/).filter(Boolean);
    if (part.includes('_') || words.length <= 1) {
      tokens.push(part);
      continue;
    }
    for (let index = 0; index < words.length; index += 1) {
      const tri = words.slice(index, index + 3).join(' ').toLowerCase();
      const bi = words.slice(index, index + 2).join(' ').toLowerCase();
      if (KNOWN_PHRASES.has(tri)) {
        tokens.push(tri);
        index += 2;
      } else if (KNOWN_PHRASES.has(bi)) {
        tokens.push(bi);
        index += 1;
      } else {
        tokens.push(words[index]);
      }
    }
  }
  return tokens.map(cleanTag).filter(Boolean);
}

export function normalizeImageTags(tags = '') {
  const normalized = [];
  const push = (tag) => {
    const clean = cleanTag(tag);
    if (!clean || BLOCKED_TAGS.has(clean) || normalized.includes(clean)) return;
    if (clean.startsWith('rating:') || clean.startsWith('order:')) return;
    normalized.push(clean);
  };

  splitTags(tags).forEach(push);
  if (!normalized.some((tag) => /^1(girl|boy)$/.test(tag))) push('1girl');
  if (!normalized.includes('solo')) push('solo');
  if (!normalized.some((tag) => /dress|shirt|skirt|uniform|bikini|sweater|kimono|jacket|pantyhose/.test(tag))) {
    push('t-shirt');
  }
  if (!normalized.some((tag) => /breasts|cleavage|nude|sex/.test(tag))) {
    push('huge_breasts');
  }
  return normalized.slice(0, 24);
}

async function lookupTag(tag) {
  if (!tag || TAG_CACHE.has(tag)) return TAG_CACHE.get(tag) || null;
  const params = new URLSearchParams({ 'search[name_matches]': tag, limit: '3' });
  try {
    const response = await fetch(`${DANBOORU_TAGS_URL}?${params}`, { headers: baseHeaders() });
    if (!response.ok) throw new Error(String(response.status));
    const matches = await response.json();
    const exact = matches.find((item) => item.name === tag) || matches[0] || null;
    const payload = exact ? { name: exact.name, category: exact.category, postCount: exact.post_count || 0 } : null;
    TAG_CACHE.set(tag, payload);
    return payload;
  } catch {
    TAG_CACHE.set(tag, null);
    return null;
  }
}

function tagWeight(tag, meta) {
  const priority = TAG_PRIORITY.findIndex((pattern) => pattern.test(tag));
  const typeBonus = priority >= 0 ? (TAG_PRIORITY.length - priority) * 1000 : 0;
  const rarity = meta?.postCount ? Math.max(0, 800 - Math.log10(meta.postCount + 1) * 100) : 0;
  return typeBonus + rarity;
}

async function rankTags(tags) {
  const metas = await Promise.all(tags.map((tag) => lookupTag(tag)));
  return tags
    .map((tag, index) => ({ tag, meta: metas[index], weight: tagWeight(tag, metas[index]) }))
    .filter((item) => item.meta !== null || /^(1girl|1boy|solo)$/.test(item.tag))
    .sort((a, b) => b.weight - a.weight)
    .map((item) => item.tag);
}

function normalizePost(post, requestedTags, query) {
  const allTags = String(post.tag_string || '').split(' ').filter(Boolean);
  const tagSet = new Set(allTags);
  const matchedTags = requestedTags.filter((tag) => tagSet.has(tag));
  const score = Number(post.score || 0);
  const imageArea = Number(post.image_width || 0) * Number(post.image_height || 0);
  const localScore = matchedTags.length * 1000
    + Math.min(score, 200) * 4
    + Math.min(Math.round(imageArea / 500000), 40)
    + (post.rating === 'e' ? 15 : post.rating === 'q' ? 8 : 0);
  return {
    id: post.id,
    rating: post.rating,
    score,
    width: post.image_width,
    height: post.image_height,
    previewUrl: post.preview_file_url,
    sampleUrl: post.large_file_url || post.file_url || post.preview_file_url,
    fileUrl: post.file_url || post.large_file_url || post.preview_file_url,
    source: post.source || '',
    tags: allTags.slice(0, 48),
    matchedTags,
    localScore,
    query,
    postUrl: `https://danbooru.donmai.us/posts/${post.id}`
  };
}

function buildQueries(rankedTags, rating = 'e') {
  const queries = [];
  const add = (tags, reason) => {
    const clean = tags.filter(Boolean).slice(0, 2);
    const key = clean.join(' ');
    if (!key || queries.some((item) => item.tags.join(' ') === key)) return;
    queries.push({ tags: clean, reason });
  };
  if (rankedTags.length >= 2) add(rankedTags.slice(0, 2), 'two high-value tags');
  for (const tag of rankedTags.slice(0, 6)) add([tag, `rating:${rating}`], `${tag} + rating:${rating}`);
  for (const tag of rankedTags.slice(0, 6)) add([tag], `${tag} fallback`);
  add(['1girl', `rating:${rating}`], 'default fallback');
  return queries;
}

async function fetchPosts(query, pageNumber, fetchLimit) {
  const params = new URLSearchParams({
    tags: query.tags.join(' '),
    limit: String(fetchLimit),
    page: String(pageNumber)
  });
  const response = await fetch(`${DANBOORU_POSTS_URL}?${params}`, { headers: baseHeaders() });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`${response.status} ${detail.slice(0, 160)}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function searchDanbooru({ tags = '', limit = 10, usedIds = [], page = 1, offset = 0, includeUsed = false, rating = 'e' }) {
  const count = Number(limit) === 5 ? 5 : 10;
  const normalized = normalizeImageTags(tags);
  const ranked = await rankTags(normalized);
  const used = new Set((usedIds || []).map(String));
  const pageNumber = Math.max(1, Number(page || 1));
  const extraOffset = Math.max(0, Number(offset || 0));
  const fetchLimit = Math.min(100, count * 4 + extraOffset);
  const queries = buildQueries(ranked.length ? ranked : normalized, rating);
  const warnings = [];
  const seen = new Set();
  const posts = [];
  const usedQueries = [];

  for (const query of queries) {
    try {
      const batch = await fetchPosts(query, pageNumber, fetchLimit);
      usedQueries.push(query);
      for (const post of batch) {
        if (seen.has(String(post.id))) continue;
        seen.add(String(post.id));
        posts.push(post);
      }
      if (posts.length >= count * 3) break;
    } catch (error) {
      warnings.push(`${query.tags.join(' ')}: ${error.message}`);
    }
  }

  const results = posts
    .filter((post) => post.file_url || post.large_file_url || post.preview_file_url)
    .filter((post) => includeUsed || !used.has(String(post.id)))
    .map((post) => normalizePost(post, normalized, usedQueries[0] || null))
    .sort((a, b) => b.localScore - a.localScore || b.score - a.score)
    .slice(extraOffset)
    .slice(0, count);

  return {
    tags: normalized,
    rankedTags: ranked,
    queryTags: usedQueries[0]?.tags || [],
    queries: usedQueries,
    warnings,
    page: pageNumber,
    offset: extraOffset,
    next: {
      page: pageNumber + 1,
      offset: 0
    },
    results
  };
}

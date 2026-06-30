# Design Notes

## Runtime

- Node.js 20+
- Express static app
- No native database dependency
- JSON store at `data/store.json`
- Pure JavaScript PNG `chara` chunk writer

## UI

- Mobile-first single page app
- Four panels: chat, preview, models, prompts
- Desktop keeps conversation rail visible
- Mobile uses bottom tabs

## Card Flow

1. User creates or selects a conversation.
2. Chat uses active model and active prompt.
3. Assistant returns Markdown role card.
4. Preview parses Markdown sections.
5. Clicking a section inserts `[修改:section]` into the composer.
6. Export converts Markdown to Tavern Card V2 JSON.
7. Optional PNG export embeds base64 card JSON into a PNG `chara` text chunk.

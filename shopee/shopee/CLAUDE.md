# LLM Wiki — Schema & Operating Instructions

You are a wiki maintainer. Your job is to read sources, maintain this wiki, and help the user explore and synthesize knowledge. You never write to raw sources. You own the wiki layer entirely.

## Directory Structure

```
/
├── CLAUDE.md            ← this file (schema & operating instructions)
├── raw/                 ← immutable source documents (read-only for you)
│   └── assets/          ← downloaded images and attachments
└── wiki/                ← LLM-generated markdown files (you write & maintain)
    ├── index.md         ← master catalog of all pages
    ├── log.md           ← append-only activity log
    ├── overview.md      ← high-level evolving synthesis
    ├── entities/        ← pages about people, organizations, places
    ├── concepts/        ← pages about ideas, topics, themes
    ├── sources/         ← one summary page per raw source
    └── syntheses/       ← analyses, comparisons, discoveries from queries
```

## Page Format

Every wiki page (except `index.md` and `log.md`) starts with YAML frontmatter:

```yaml
---
title: Page Title
type: entity | concept | source | synthesis | overview
tags: [tag1, tag2]
sources: [source-slug]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Use `[[wikilinks]]` for all internal cross-references. Never use bare URLs for internal links.

## Operations

### Ingest
When the user drops a new source into `raw/` and says "ingest":

1. Read the source carefully
2. Discuss key takeaways with the user
3. Create `wiki/sources/<slug>.md` — factual summary of the source
4. Add the new source to `wiki/index.md`
5. Update or create `wiki/entities/` pages for key people, orgs, places
6. Update or create `wiki/concepts/` pages for key ideas and themes
7. Update `wiki/overview.md` if the synthesis shifts meaningfully
8. Append to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] ingest | <Source Title>
   ```
9. Flag contradictions with existing pages using `> [!warning]` callouts

A single ingest should touch **5–15 pages**. Update more rather than fewer.

### Query
When the user asks a question:

1. Read `wiki/index.md` to find relevant pages
2. Read those pages
3. Synthesize an answer with `[[citations]]`
4. If the answer is valuable, offer to file it as a new `wiki/syntheses/` page
5. Append to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] query | <Question summary>
   ```

### Lint
When the user asks you to lint the wiki:

1. Check for contradictions between pages
2. Find orphan pages (no inbound links from other pages)
3. Find concepts mentioned but lacking their own page
4. Find missing cross-references
5. Identify stale claims newer sources may have superseded
6. Report findings as a checklist with suggested fixes
7. Append to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] lint | <summary of findings>
   ```

## Conventions

- **Prose**: clear, concise. No filler sentences.
- **Links**: use `[[wikilinks]]` on first mention of any entity or concept that has (or should have) its own page.
- **Callouts** (Obsidian-compatible):
  - `> [!note]` — additional context
  - `> [!warning]` — contradictions or uncertain claims
  - `> [!tip]` — actionable insight
- **Frontmatter**: on every page except `index.md` and `log.md`. Always update `updated:` when modifying a page.
- **Source pages**: stay factual. Save synthesis and interpretation for concept and overview pages.
- **Naming**: lowercase kebab-case for filenames (`elon-musk.md`, `reinforcement-learning.md`).
- **Index**: always current — update it every ingest.
- **Log**: append-only — never edit past entries.

## Output Formats

Depending on the question, answers can be:
- A markdown page filed into `wiki/syntheses/`
- A comparison table (markdown)
- A Marp slide deck (add `marp: true` to frontmatter)
- A chart description for matplotlib
- Plain prose with citations

## Tips

- Obsidian Web Clipper (browser extension) converts web articles to markdown — useful for getting sources into `raw/`.
- Obsidian's graph view shows the shape of the wiki: hubs, orphans, clusters.
- The wiki is a git repo — run `git init` for version history if needed.
- For search at scale: consider `qmd` (local BM25/vector search for markdown) or a simple grep script.

# Skills Refactor Notes

This document records the confirmed conclusions for the upcoming `skills` module refactor in ClawX.

Scope:

- Refactor ClawX skill presentation and orchestration only
- Do not modify OpenClaw internal code
- Use current runtime behavior and current `SKILL.md` conventions as the source of truth

## Goals

- Keep the skills list page driven by raw runtime results only
- Stop inferring skill semantics in the renderer from text heuristics
- Read the real skill file only when the user opens skill details or edits configuration
- Separate runtime result data, managed config data, and skill file metadata

## Confirmed Product Decision

The skills list should only display raw runtime results plus the minimum rendering fields.

The renderer should not:

- infer `isCore`
- infer `sourceId` or `sourceLabel` from `baseDir`
- classify items into `claw-built-in`, `hub-market`, or `custom`
- guess `requiresKey` from config field names or description text

When the user clicks a skill, ClawX may then read the real skill file and use it to:

- render the real skill spec
- render dependency and configuration requirements
- map editable config inputs to `skills.entries.<skillKey>`

## Current Real Data Sources

There are four real data sources in the current codebase.

### 1. Runtime status

Source:

- Gateway RPC `skills.status`
- Gateway RPC `skills.update`

Current consumer:

- `src/stores/skills.ts`

Runtime currently returns fields including:

- `skillKey`
- `slug`
- `name`
- `description`
- `disabled`
- `emoji`
- `version`
- `author`
- `bundled`
- `always`
- `source`
- `baseDir`
- `filePath`
- `ready`
- `missing`
- `homepage`

Important:

- `ready` and `missing` are runtime results and should be treated as authoritative
- the full `metadata.openclaw.requires.*` shape is not currently surfaced to the renderer through this path

### 2. Managed skill config

Source:

- `~/.openclaw/deep-ai-worker/config/skills.json`

Current behavior:

- ClawX reads and writes managed state there
- ClawX syncs managed state back into `~/.openclaw/openclaw.json`

This is the source of truth for:

- `enabled` overrides
- `apiKey`
- `env`
- future per-skill editable config owned by ClawX

### 3. Skill source config

Source:

- `skill-sources.json`

Current behavior:

- ClawX manages source definitions
- ClawX syncs source workdirs into `skills.load.extraDirs`

This is infrastructure state, not primary list-page display data.

### 4. Real skill file

Source:

- `SKILL.md`

This is the source of truth for:

- skill markdown instructions
- `homepage`
- `metadata.openclaw.primaryEnv`
- `metadata.openclaw.requires.env`
- `metadata.openclaw.requires.config`
- `metadata.openclaw.requires.bins`
- `metadata.openclaw.requires.anyBins`

This file should be read lazily, on demand, for detail view and config rendering.

Detail rendering rule:

- show structured information first
- keep raw markdown available in a collapsed section

## What The List Page Should Show

The list page should show a compact raw runtime model.

Minimum recommended list fields:

- `id`
- `name`
- `description`
- `enabled`
- `ready`
- `version`
- `missing`

Optional list fields if already available cheaply:

- `homepage`
- `author`

The list page should not parse `SKILL.md` and should not inspect raw dependency declarations directly.

Important:

- do not introduce a derived status field such as `statusSummary`
- the list should reflect original fields such as `enabled`, `ready`, and `missing`
- `missing` on the list page should only produce a lightweight hint
- full `missing` details belong to the detail view

## Meaning Of `missing`

`missing` is a runtime diagnostic result returned by OpenClaw.

Meaning:

- the skill was discovered
- runtime determined that some requirement is still missing
- `ready` may therefore be `false`

UI rule:

- list page should primarily use `ready`
- list page should show only a lightweight hint when `missing` exists
- details page may expand and show full `missing`

Do not replace `missing` with a renderer-side guess.

## How To Judge External Dependencies

For dependency semantics, use real skill metadata, not string heuristics.

The canonical fields are:

- `metadata.openclaw.requires.env`
- `metadata.openclaw.requires.config`
- `metadata.openclaw.requires.bins`
- `metadata.openclaw.requires.anyBins`
- `metadata.openclaw.primaryEnv`

Rules:

- `requires.env` means the skill has declared environment-variable requirements
- `requires.config` means the skill has declared OpenClaw config requirements
- `requires.bins` or `requires.anyBins` means the skill depends on external binaries
- `primaryEnv` is the canonical primary credential env name, but is not by itself a hard requirement

Important:

- do not infer external dependency from description text
- do not infer external dependency from config key names
- do not treat `primaryEnv` alone as proof that the skill is blocked

## Proposed Runtime Models

### SkillListItem

Used by the list page only and should stay close to raw runtime results.

```ts
type SkillListItem = {
  id: string
  name: string
  description: string
  enabled: boolean
  ready: boolean
  version?: string
  missing?: string[]
}
```

### SkillDetail

Built only when the user opens a skill.

```ts
type SkillDetail = {
  skill: SkillListItem
  runtime: {
    missing?: string[]
    baseDir?: string
    filePath?: string
    homepage?: string
    author?: string
  }
  config: {
    apiKey?: string
    env?: Record<string, string>
  }
  spec: {
    rawMarkdown?: string
    homepage?: string
    primaryEnv?: string
    requires?: {
      env?: string[]
      config?: string[]
      bins?: string[]
      anyBins?: string[]
    }
  }
}
```

## Target Interaction Model

### List flow

- backend returns raw runtime result plus only the minimum fields needed for rendering
- renderer gets `SkillListItem[]`
- renderer does not parse skill files

### Detail flow

- user opens a skill
- backend reads runtime state, managed config, and real `SKILL.md`
- backend parses frontmatter and returns `SkillDetail`
- renderer shows structured information first and raw markdown in a collapsed section
- renderer renders editable config, enabled state, and delete action
- if `SKILL.md` parsing fails, the detail page should still open using runtime and managed config data, with a parse-failure notice

### Edit flow

- edits are applied to managed config owned by ClawX
- mapping to env or api key uses real skill metadata when available
- enabled state changes should call runtime `skills.update` directly
- managed config remains the owner of editable per-skill config values

Config form generation rules:

- generate the main credential field from `metadata.openclaw.primaryEnv` when present
- generate required env fields from `metadata.openclaw.requires.env`
- if a required env matches `primaryEnv`, do not render it twice
- managed env keys that are not part of `requires.env` should appear under an additional collapsed env section
- do not auto-render arbitrary custom `config` fields

### Delete flow

- delete means deleting the skill directory
- delete should target the resolved local skill directory
- delete behavior is based on actual file location rather than a UI category
- delete applies uniformly regardless of bundled, managed, workspace, or extra-dir origin

## Refactor Constraints

- Do not change OpenClaw internals
- Do not add new renderer-side heuristic classification for dependency or source type
- Do not make the list page depend on lazy file parsing
- Do not invent derived status labels for the list page
- Keep the detail page file-driven
- Prefer computed DTOs from the main process over client-side data merging
- Render detail as structured information first, with raw markdown collapsed
- Treat delete as directory deletion
- Treat delete uniformly for all local skill directories
- Apply enabled-state changes through runtime `skills.update`
- Generate config forms only from `primaryEnv`, `requires.env`, and managed `apiKey/env`
- Do not auto-render arbitrary custom skill config fields
- If `SKILL.md` parsing fails, fall back to runtime and managed config data

## Development Implications

The refactor should move toward:

- a backend aggregated list endpoint for list rendering
- a backend skill detail endpoint that reads and parses the real `SKILL.md`
- a thinner `src/stores/skills.ts`
- removal of renderer heuristics such as `requiresKey` and source-category guessing

This document is the baseline for subsequent implementation work.

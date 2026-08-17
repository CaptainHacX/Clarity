# Clarity

A modern, open-source system cleaner for Windows, macOS, and Linux built with Electron.

## Releasing

All releases are done via a single command:

```
npm run release -- patch|minor|major
```

This handles everything: version bump, changelog generation, commit, tag, push, and triggers CI to build and publish.

`conventional-changelog` and `conventional-changelog-angular` are both direct
devDependencies even though nothing imports them, and the preset must stay on
`^9`. Two separate reasons, both load-bearing:

- **The CLI has to be local.** `scripts/release.js` shells out to
  `npx conventional-changelog`. Without the local dependency, npx downloads the
  CLI into its own cache directory, from which it cannot resolve a preset out of
  this project's `node_modules` — the run dies with
  `Unable to load the "angular" preset`.
- **The preset major must match the CLI major.** `conventional-changelog@8` is
  the `@conventional-changelog/*` rewrite: it reads the new preset shape
  (`{ commits, parser, writer, whatBump }`) and calls `writer.headerPartial` as a
  function. Preset `8.x` still exports the legacy
  `{ parserOpts, writerOpts }` with Handlebars template *strings*, so the CLI
  sees no `writer` at all and throws
  `TypeError: headerPartial is not a function`. Preset `9.x` exports the new
  shape. Don't "downgrade to `^8`" — that is the bug, not the fix.

`npm ls conventional-changelog conventional-changelog-angular` should show
`8.x` and `9.x` respectively at the top level. To verify changelog generation
without cutting a release, bump `version` in a scratch copy of the repo and run
`npx conventional-changelog -p angular -i CHANGELOG.md -s`.

## Testing

```
npm test              # run all tests once (vitest run)
npm run test:watch    # run tests in watch mode
npm run validate:rules # validate rule JSON files against schema
```

## Development

```
npm run dev
```

## Commit Conventions

Always use [Conventional Commits](https://www.conventionalcommits.org/). Format:

```
<type>(<scope>): <short summary>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

Examples:
- `feat(rules): add new browser cache cleaning rule`
- `fix(scanner): handle missing registry keys on Windows`
- `refactor(ui): extract settings panel into separate component`
- `test(engine): add unit tests for file size calculation`

Breaking changes must include `!` after the type/scope (e.g., `feat(api)!: redesign plugin interface`).

# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- **Architecture**: stripe-axi shells out to the official Stripe CLI (`stripe`) via `src/stripe/cli.ts` rather than calling `api.stripe.com` directly or using the `stripe` npm SDK. All calls use the CLI's `get`/`post`/`delete` raw passthrough (`stripe post /v1/refunds -d ...`), not its per-resource subcommands (`stripe customers ...`) — the passthrough's syntax is fully documented for every resource, while resource-command operation names are dynamically introspected per resource and weren't safely enumerable offline. See the "Design notes" section of README.md for the full rationale.
- **Safety gate** (`src/safety/gate.ts`): every mutating command is dry-run by default, needs `--confirm` to execute, and needs `--confirm` + `--i-understand-this-is-live` together in LIVE mode (key prefix `sk_live_`/`rk_live_`). This is the core design constraint of the whole tool — any new mutating command MUST route through `runGatedWrite`/`makeGatedCommand` (see `src/commands/factory.ts`), never call `stripeCliRequest` directly for a write.
- **Adding a new command**: use the builders in `src/commands/factory.ts` (`makeListCommand`/`makeDetailCommand`/`makeGatedCommand`) rather than hand-rolling a `CommandModule` — they enforce the shared TOON/pagination/gating conventions. Register new commands in `src/index.ts`'s registry and add them to `COMMANDS` in `src/skill/content.ts` (drives both `--help` and the generated SKILL.md).
- **Testing `stripe/cli.ts`**: process execution is swapped via dependency injection (`SpawnFn` parameter), not `vi.mock("node:child_process", ...)` — built-in module mocks were unreliable here and caused tests to hang for the full 60s timeout instead of failing fast. See `test/stripe-cli.test.ts`.
- **TOON output gotcha**: a printed line's leading `key:` segment (before the first colon) cannot contain a space — it fails `parseToon`'s header regex. Any resource/command name used as a TOON key (e.g. in `emitList`) must have spaces stripped first (see `toonName` in `factory.ts`'s `makeListCommand`).
- No live Stripe key is available in the dev/CI environment; the test suite (`npm test`) is fully offline and mocks the Stripe CLI process. Live smoke-testing with a `sk_test_...` key is a manual, documented step in README.md, not part of CI.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

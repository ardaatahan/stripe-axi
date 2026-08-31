// Shared builders so each resource's command file stays a short config
// object instead of re-implementing list/detail/gated-write boilerplate.

import type { CommandModule } from "../cli/router.js";
import type { ArgSpec, CommandSpec, FlagSpec } from "../cli/spec.js";
import type { Parsed } from "../cli/args.js";
import { UsageError } from "../output/errors.js";
import { emitList, print, toonValue } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { requireKey, type KeyInfo } from "../stripe/config.js";
import { shellQuote, stripeCliRequest } from "../stripe/cli.js";
import { assertResourceId } from "../stripe/ids.js";
import { CONFIRM_FLAG, LIVE_ACK_FLAG, runGatedWrite, type PlannedWrite } from "../safety/gate.js";

export const LIMIT_FLAG: FlagSpec = {
  name: "limit",
  type: "string",
  default: "10",
  description: "max results, 1-100",
};

export const STARTING_AFTER_FLAG: FlagSpec = {
  name: "starting-after",
  type: "string",
  description: "paginate: object ID to resume after",
};

export function parseLimit(flags: Record<string, string | boolean>): number {
  const raw = String(flags["limit"] ?? "10");
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new UsageError(`invalid --limit '${raw}'`, "--limit must be an integer between 1 and 100");
  }
  return n;
}

/**
 * Validates a money amount and returns it in Stripe's canonical form, so
 * "010000" and "10000" are one request with one Idempotency-Key rather than
 * two keys for the same payout.
 */
export function parseAmount(raw: string, flag = "amount"): string {
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(
      `invalid --${flag} '${raw}'`,
      `--${flag} is a whole number of the currency's smallest unit (e.g. 500 for $5.00)`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new UsageError(`invalid --${flag} '${raw}'`, `--${flag} must be a positive whole number`);
  }
  return String(value);
}

/**
 * The next page must be the SAME view, one page along: an agent following this
 * suggestion with the filters dropped would silently page through a different
 * result set.
 */
function nextPageCommand(name: string, spec: CommandSpec, flags: Record<string, string | boolean>, lastId: string): string {
  const parts = [`stripe-axi ${name}`];
  for (const flag of spec.flags) {
    if (flag.name === "starting-after") continue;
    const value = flags[flag.name];
    if (value === undefined || value === "" || value === false) continue;
    if (flag.default !== undefined && value === flag.default) continue;
    if (flag.type === "boolean") parts.push(`--${flag.name}`);
    else parts.push(`--${flag.name}`, shellQuote(String(value)));
  }
  parts.push("--starting-after", shellQuote(lastId));
  return parts.join(" ");
}

export interface ListConfig {
  name: string;
  summary: string;
  path: string;
  fields: string[];
  defaultFields: string;
  extraFlags?: FlagSpec[];
  buildParams: (flags: Record<string, string | boolean>) => Record<string, unknown>;
  mapRow: (raw: any) => Record<string, unknown>;
  examples: string[];
  emptyContext: (flags: Record<string, string | boolean>) => string;
  suggestions: (flags: Record<string, string | boolean>, rows: Array<Record<string, unknown>>) => string[];
}

export function makeListCommand(cfg: ListConfig): CommandModule {
  const spec: CommandSpec = {
    name: cfg.name,
    summary: cfg.summary,
    flags: [
      ...(cfg.extraFlags ?? []),
      LIMIT_FLAG,
      STARTING_AFTER_FLAG,
      {
        name: "fields",
        type: "string",
        default: cfg.defaultFields,
        description: `comma-separated columns from: ${cfg.fields.join(", ")}`,
      },
    ],
    examples: cfg.examples,
  };
  return {
    spec,
    async run(parsed) {
      const fields = String(parsed.flags["fields"]).split(",").map((f) => f.trim());
      for (const f of fields) {
        if (!cfg.fields.includes(f)) {
          throw new UsageError(`unknown field '${f}' for --fields`, `valid fields: ${cfg.fields.join(", ")}`);
        }
      }
      parseLimit(parsed.flags);
      const keyInfo = requireKey();
      const params = cfg.buildParams(parsed.flags);
      const result = await stripeCliRequest({ method: "GET", path: cfg.path, params, apiKey: keyInfo.key });
      const rawRows: any[] = result.data ?? [];
      const rows = rawRows.map(cfg.mapRow);
      // TOON headers/keys can't contain spaces (see output/toon.js parseToon),
      // but cfg.name may (e.g. "checkout sessions") for display in --help.
      const toonName = cfg.name.replace(/\s+/g, "_");

      print(`mode: ${keyInfo.mode.toUpperCase()}`);
      if (rows.length === 0) {
        print(`${toonName}: ${toonValue(`0 results (${cfg.emptyContext(parsed.flags)})`)}`);
        print(helpBlock(cfg.suggestions(parsed.flags, rows)));
        return 0;
      }

      print(emitList(toonName, rows, fields));
      const suggestions = [...cfg.suggestions(parsed.flags, rows)];
      if (result.has_more) {
        const lastId = String(rawRows[rawRows.length - 1]?.id ?? "");
        suggestions.unshift(`${nextPageCommand(cfg.name, spec, parsed.flags, lastId)} (more results)`);
      }
      print(helpBlock(suggestions));
      return 0;
    },
  };
}

export interface DetailConfig {
  name: string;
  summary: string;
  argName: string;
  path: (id: string) => string;
  render: (raw: any, keyInfo: KeyInfo) => void;
  examples: string[];
  suggestions: (id: string, raw: any) => string[];
}

export function makeDetailCommand(cfg: DetailConfig): CommandModule {
  const args: ArgSpec[] = [{ name: cfg.argName, required: true, description: `the ${cfg.name} ID` }];
  return {
    spec: { name: cfg.name, summary: cfg.summary, args, flags: [], examples: cfg.examples },
    async run(parsed) {
      const id = assertResourceId(parsed.positionals[0]!, cfg.argName);
      const keyInfo = requireKey();
      const result = await stripeCliRequest({ method: "GET", path: cfg.path(id), apiKey: keyInfo.key });
      cfg.render(result, keyInfo);
      print(helpBlock(cfg.suggestions(id, result)));
      return 0;
    },
  };
}

export interface GatedConfig {
  name: string;
  summary: string;
  args?: ArgSpec[];
  extraFlags?: FlagSpec[];
  examples: string[];
  build: (parsed: Parsed, keyInfo: KeyInfo) => PlannedWrite;
  onSuccess: (result: any, keyInfo: KeyInfo) => void;
}

export function makeGatedCommand(cfg: GatedConfig): CommandModule {
  const spec: CommandSpec = {
    name: cfg.name,
    summary: cfg.summary,
    args: cfg.args,
    flags: [...(cfg.extraFlags ?? []), CONFIRM_FLAG, LIVE_ACK_FLAG],
    examples: cfg.examples,
  };
  return {
    spec,
    async run(parsed) {
      parsed.positionals.forEach((value, i) => assertResourceId(value, cfg.args?.[i]?.name ?? "id"));
      const keyInfo = requireKey();
      const plan = cfg.build(parsed, keyInfo);
      const confirm = Boolean(parsed.flags["confirm"]);
      const liveAck = Boolean(parsed.flags["i-understand-this-is-live"]);
      return runGatedWrite({ keyInfo, confirm, liveAck }, plan, (result) => cfg.onSuccess(result, keyInfo));
    },
  };
}

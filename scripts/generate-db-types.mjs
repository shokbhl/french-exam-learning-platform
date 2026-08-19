#!/usr/bin/env node
//
// Generates src/lib/supabase/database.types.ts by introspecting a live
// PostgreSQL database.
//
// `supabase gen types` is the usual tool for this, but every current version
// of the CLI shells out to a Docker image even when given a direct --db-url,
// so it cannot run on a machine without a container runtime or in a CI job
// that only has a Postgres service. This script talks to the database through
// psql instead and emits the same shape the Supabase client expects, so
// `createClient<Database>()` is typed the same way either tool is used.
//
// Usage:
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=app \
//     node scripts/generate-db-types.mjs
//
// Connection settings come from the standard libpq environment variables, or
// from DATABASE_URL if set.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUTPUT = "src/lib/supabase/database.types.ts";
const psqlBin = process.env.PSQL_BIN ?? "psql";

/** Runs a query and returns its single JSON result. */
function query(sql) {
  const args = ["-t", "-A", "-X", "-v", "ON_ERROR_STOP=1", "-c", sql];
  if (process.env.DATABASE_URL) args.unshift(process.env.DATABASE_URL);
  const out = execFileSync(psqlBin, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.trim() || "[]");
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

const enums = query(`
  select coalesce(json_agg(e order by e->>'name'), '[]'::json) from (
    select json_build_object(
      'name', t.typname,
      'values', (
        select json_agg(l.enumlabel order by l.enumsortorder)
        from pg_enum l where l.enumtypid = t.oid
      )
    ) as e
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  ) s
`);

const columns = query(`
  select coalesce(json_agg(c order by c->>'table', (c->>'position')::int), '[]'::json) from (
    select json_build_object(
      'table', c.relname,
      'name', a.attname,
      'position', a.attnum,
      'udt', format_type(a.atttypid, null),
      'base_udt', t.typname,
      'not_null', a.attnotnull,
      'has_default', (a.atthasdef and coalesce(ad.adbin::text not like '%nextval%', true)),
      'is_generated', (a.attgenerated <> '' or a.attidentity <> ''),
      'is_enum', (t.typtype = 'e'),
      'is_array', (t.typcategory = 'A')
    ) as c
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
    where n.nspname = 'public'
      and c.relkind in ('r', 'v', 'm', 'p')
      and a.attnum > 0
      and not a.attisdropped
  ) s
`);

const relations = query(`
  select coalesce(json_agg(r order by r->>'name'), '[]'::json) from (
    select json_build_object('name', c.relname, 'kind', c.relkind) as r
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  ) s
`);

const functions = query(`
  select coalesce(json_agg(f order by f->>'name'), '[]'::json) from (
    select json_build_object(
      'name', p.proname,
      'returns', pg_get_function_result(p.oid),
      'args', pg_get_function_arguments(p.oid)
    ) as f
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- Skip extension-owned functions (pgvector installs a large surface).
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
      -- Trigger and event-trigger functions are not callable through
      -- PostgREST, and the platform installs some of its own (rls_auto_enable),
      -- which would otherwise make generated output differ between a hosted
      -- project and a local test database.
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
  ) s
`);

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

const SCALARS = new Map([
  ["uuid", "string"],
  ["text", "string"],
  ["character varying", "string"],
  ["character", "string"],
  ["citext", "string"],
  ["date", "string"],
  ["timestamp with time zone", "string"],
  ["timestamp without time zone", "string"],
  ["time with time zone", "string"],
  ["time without time zone", "string"],
  ["interval", "string"],
  ["bytea", "string"],
  ["tsvector", "string"],
  ["vector", "string"],
  ["boolean", "boolean"],
  ["smallint", "number"],
  ["integer", "number"],
  ["bigint", "number"],
  ["numeric", "number"],
  ["real", "number"],
  ["double precision", "number"],
  ["json", "Json"],
  ["jsonb", "Json"],
]);

const enumNames = new Set(enums.map((e) => e.name));

function tsType(column) {
  const udt = column.udt;

  if (column.is_array || udt.endsWith("[]")) {
    const element = udt.replace(/\[\]$/, "").replace(/^_/, "");
    return `${mapName(element)}[]`;
  }
  return mapName(udt);
}

function mapName(name) {
  const bare = name.replace(/^public\./, "").replace(/\(.*\)$/, "").trim();
  if (enumNames.has(bare)) return `Database["public"]["Enums"]["${bare}"]`;
  return SCALARS.get(bare) ?? SCALARS.get(name) ?? "unknown";
}

function nullable(type, notNull) {
  return notNull ? type : `${type} | null`;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const byTable = new Map();
for (const column of columns) {
  if (!byTable.has(column.table)) byTable.set(column.table, []);
  byTable.get(column.table).push(column);
}

const lines = [];
lines.push("// Generated by scripts/generate-db-types.mjs. Do not edit by hand.");
lines.push("//");
lines.push("// Regenerate after every migration:");
lines.push("//   npm run db:types");
lines.push("");
lines.push("export type Json =");
lines.push("  | string");
lines.push("  | number");
lines.push("  | boolean");
lines.push("  | null");
lines.push("  | { [key: string]: Json | undefined }");
lines.push("  | Json[];");
lines.push("");
lines.push("export type Database = {");
lines.push("  public: {");

// Tables and views
const tableNames = relations.filter((r) => r.kind !== "v" && r.kind !== "m").map((r) => r.name).sort();
const viewNames = relations.filter((r) => r.kind === "v" || r.kind === "m").map((r) => r.name).sort();

function emitRelations(names, label, withWrites) {
  lines.push(`    ${label}: {`);
  if (names.length === 0) {
    lines.push("      [_ in never]: never;");
  }
  for (const name of names) {
    const cols = byTable.get(name) ?? [];
    lines.push(`      ${name}: {`);

    lines.push("        Row: {");
    for (const c of cols) {
      lines.push(`          ${c.name}: ${nullable(tsType(c), c.not_null)};`);
    }
    lines.push("        };");

    if (withWrites) {
      lines.push("        Insert: {");
      for (const c of cols) {
        if (c.is_generated) continue;
        const optional = c.has_default || !c.not_null ? "?" : "";
        lines.push(`          ${c.name}${optional}: ${nullable(tsType(c), c.not_null)};`);
      }
      lines.push("        };");

      lines.push("        Update: {");
      for (const c of cols) {
        if (c.is_generated) continue;
        lines.push(`          ${c.name}?: ${nullable(tsType(c), c.not_null)};`);
      }
      lines.push("        };");
    }

    // supabase-js resolves query result types through this key. Omitting it
    // makes every `.from(...)` call collapse to `never`, so it must be
    // present even when foreign keys are not described.
    lines.push("        Relationships: [];");
    lines.push("      };");
  }
  lines.push("    };");
}

emitRelations(tableNames, "Tables", true);
emitRelations(viewNames, "Views", false);

// Functions: the argument and return shapes are reported as SQL text, which is
// enough for a caller to see the signature without guessing.
lines.push("    Functions: {");
if (functions.length === 0) lines.push("      [_ in never]: never;");
for (const fn of functions) {
  lines.push(`      ${fn.name}: {`);
  lines.push(`        /** ${fn.args || "no arguments"} */`);
  lines.push("        Args: Record<string, unknown>;");
  lines.push(`        /** returns ${fn.returns} */`);
  lines.push("        Returns: unknown;");
  lines.push("      };");
}
lines.push("    };");

lines.push("    Enums: {");
if (enums.length === 0) lines.push("      [_ in never]: never;");
for (const e of enums) {
  lines.push(`      ${e.name}: ${e.values.map((v) => JSON.stringify(v)).join(" | ")};`);
}
lines.push("    };");

// Also required by the client's generics, even when empty.
lines.push("    CompositeTypes: {");
lines.push("      [_ in never]: never;");
lines.push("    };");

lines.push("  };");
lines.push("};");
lines.push("");
lines.push("export type Tables<T extends keyof Database[\"public\"][\"Tables\"]> =");
lines.push("  Database[\"public\"][\"Tables\"][T][\"Row\"];");
lines.push("export type TablesInsert<T extends keyof Database[\"public\"][\"Tables\"]> =");
lines.push("  Database[\"public\"][\"Tables\"][T][\"Insert\"];");
lines.push("export type TablesUpdate<T extends keyof Database[\"public\"][\"Tables\"]> =");
lines.push("  Database[\"public\"][\"Tables\"][T][\"Update\"];");
lines.push("export type Enums<T extends keyof Database[\"public\"][\"Enums\"]> =");
lines.push("  Database[\"public\"][\"Enums\"][T];");
lines.push("");

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, lines.join("\n"));

console.log(
  `Wrote ${OUTPUT}: ${tableNames.length} tables, ${viewNames.length} views, ` +
    `${enums.length} enums, ${functions.length} functions.`,
);

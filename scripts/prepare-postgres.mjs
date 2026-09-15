#!/usr/bin/env node
/**
 * Generate the Postgres schema from the canonical one.
 *
 * Prisma will not accept an env var for `provider` - it must be a literal - so
 * the production schema is derived from prisma/schema.prisma by rewriting that
 * single line. Deriving it rather than maintaining a second copy means the
 * models cannot drift apart.
 *
 * Why this exists at all: the committed migrations under prisma/migrations are
 * SQLite DDL (they contain PRAGMA statements and DATETIME columns) and would
 * fail outright against Postgres. See DEPLOY.md.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "prisma/schema.prisma";
const TARGET = "prisma/schema.postgres.prisma";

const schema = readFileSync(SOURCE, "utf8");
if (!schema.includes('provider = "sqlite"')) {
  console.error(`[prepare-postgres] expected a sqlite provider in ${SOURCE}`);
  process.exit(1);
}

const out = schema.replace('provider = "sqlite"', 'provider = "postgresql"');
writeFileSync(TARGET, `// GENERATED from ${SOURCE} by scripts/prepare-postgres.mjs.\n// Do not edit: change the source schema instead.\n${out}`);
console.log(`[prepare-postgres] wrote ${TARGET}`);

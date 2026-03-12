import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key || key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // Optional env file; ignore if missing or unreadable.
  }
}

loadEnvFile(join(projectRoot, ".env.local"));
loadEnvFile(join(projectRoot, ".env"));

const migrationFiles = readdirSync(__dirname)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL not set (checked process env, .env.local, and .env)");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  console.log("Connecting to database...");
  for (const file of migrationFiles) {
    console.log(`Applying ${file}...`);
    const sql = readFileSync(join(__dirname, file), "utf-8");
    await pool.query(sql);
  }
  console.log("Migration completed successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}

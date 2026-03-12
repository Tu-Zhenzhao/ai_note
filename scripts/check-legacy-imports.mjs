import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "app", "tests"];
const FILE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

const bannedPatterns = [
  { label: "legacy_orchestration_engine", pattern: /from\s+["']@\/server\/orchestration\/engine["']/ },
  { label: "legacy_planner_runtime", pattern: /from\s+["']@\/server\/planner\/runtime["']/ },
  { label: "legacy_planner_tools", pattern: /from\s+["']@\/server\/planner\/tools["']/ },
  { label: "legacy_structured_extraction", pattern: /from\s+["']@\/server\/services\/extraction["']/ },
  { label: "legacy_checklist_updater_tool", pattern: /from\s+["']@\/server\/tools\/checklist-updater["']/ },
  { label: "legacy_followup_rules", pattern: /from\s+["']@\/server\/rules\/followup["']/ },
  { label: "langgraph_dependency", pattern: /from\s+["']@langchain\/langgraph["']/ },
];

function collectFiles(dir, out) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    const dot = full.lastIndexOf(".");
    const ext = dot >= 0 ? full.slice(dot) : "";
    if (FILE_EXTENSIONS.has(ext)) {
      out.push(full);
    }
  }
}

const files = [];
for (const dir of SCAN_DIRS) {
  collectFiles(join(ROOT, dir), files);
}

const violations = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const banned of bannedPatterns) {
    if (banned.pattern.test(content)) {
      violations.push({
        file: file.replace(`${ROOT}/`, ""),
        rule: banned.label,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("Legacy import guard failed. Remove these references:");
  for (const v of violations) {
    console.error(`- ${v.file} (${v.rule})`);
  }
  process.exit(1);
}

console.log("Legacy import guard passed.");

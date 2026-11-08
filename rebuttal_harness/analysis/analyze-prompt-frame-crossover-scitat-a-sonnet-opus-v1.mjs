import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeCompletedAudit,
  renderMarkdownReport,
} from "./lib/prompt-frame-crossover-stats.mjs";

const studyId = "prompt_frame_crossover_scitat_a_sonnet_opus_v1";

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--audit") result.audit = argv[++index];
    else if (token === "--json") result.json = argv[++index];
    else if (token === "--markdown") result.markdown = argv[++index];
    else if (token === "--preregistration") result.preregistration = argv[++index];
    else if (token === "--help" || token === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return result;
}
export function runAnalysisCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArguments(argv);
  if (args.help) {
    console.log(
      "Usage: node analysis/analyze-prompt-frame-crossover-scitat-a-sonnet-opus-v1.mjs " +
      "[--audit analysis/...-audit.json] [--json analysis/...-results.json] " +
      "[--markdown analysis/...-results.md] [--preregistration ../PREREGISTRATION_...md]",
    );
    return null;
  }

  const auditPath = path.resolve(
    cwd,
    args.audit ?? path.join("analysis", `${studyId.replaceAll("_", "-")}-audit.json`),
  );
  const jsonPath = path.resolve(
    cwd,
    args.json ?? path.join("analysis", `${studyId.replaceAll("_", "-")}-results.json`),
  );
  const markdownPath = path.resolve(
    cwd,
    args.markdown ?? path.join("analysis", `${studyId.replaceAll("_", "-")}-results.md`),
  );
  const preregistrationPath = path.resolve(
    cwd,
    args.preregistration ?? path.join("..", "PREREGISTRATION_SONNET_OPUS_SCITAT_A_PROMPT_PROTOCOL_CROSSOVER_2026-11-03_1308_CST.md"),
  );

  for (const [label, target] of [["audit", auditPath], ["preregistration", preregistrationPath]]) {
    if (!fs.existsSync(target)) throw new Error(`${label} file does not exist: ${target}`);
  }
  if (new Set([auditPath, preregistrationPath, jsonPath, markdownPath]).size !== 4) {
    throw new Error("Audit, preregistration, JSON output, and Markdown output paths must all be distinct.");
  }

  // This gate is intentionally evaluated before either result file is written.
  // A planned, partial, invalid, or failed audit therefore cannot produce an
  // analysis artifact, even if some run summaries already exist on disk.
  const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
  const report = analyzeCompletedAudit(audit, {
    auditPath,
    preregistrationPath,
  });
  const markdown = renderMarkdownReport(report);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown);
  console.log(JSON.stringify({
    status: "complete",
    auditPath,
    jsonPath,
    markdownPath,
    cells: Object.keys(report.cells).length,
    coPrimaryTests: report.coPrimary.length,
    supportingSimpleEffects: report.supporting.simpleEffects.length,
    factorialInteractions: report.supporting.factorialInteractions.length,
  }, null, 2));
  return { report, markdown, auditPath, jsonPath, markdownPath };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    runAnalysisCli();
  } catch (error) {
    console.error(`Analysis refused: ${error.message}`);
    process.exitCode = 1;
  }
}

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const v1 = JSON.parse(fs.readFileSync(path.join(root, "experiments", "prompt_frame_crossover_v1", "study-manifest.json"), "utf8"));
const v2 = JSON.parse(fs.readFileSync(path.join(root, "experiments", "prompt_frame_crossover_v2", "study-manifest.json"), "utf8"));
const signature = (manifest) => manifest.cells
  .map((cell) => ({
    schedulePosition: cell.schedulePosition,
    order: cell.order,
    arm: cell.arm,
    turnOrder: cell.turnOrder,
  }))
  .sort((left, right) => left.schedulePosition - right.schedulePosition);
if (JSON.stringify(signature(v1)) !== JSON.stringify(signature(v2))) {
  throw new Error("V2 schedule or order pairing differs from the frozen v1 design.");
}

process.env.PROMPT_FRAME_STUDY_ID = "prompt_frame_crossover_v2";
process.env.PROMPT_FRAME_EXPECTED_OUTPUT_TOKEN_CAP = "1024";

await import("./audit-prompt-frame-crossover-v1.mjs");

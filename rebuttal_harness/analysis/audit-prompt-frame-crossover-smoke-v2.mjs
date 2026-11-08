process.env.PROMPT_FRAME_SMOKE_STUDY_ID = "prompt_frame_crossover_smoke_v2";
process.env.PROMPT_FRAME_FULL_STUDY_ID = "prompt_frame_crossover_v2";
process.env.PROMPT_FRAME_EXPECTED_OUTPUT_TOKEN_CAP = "1024";

await import("./audit-prompt-frame-crossover-smoke-v1.mjs");

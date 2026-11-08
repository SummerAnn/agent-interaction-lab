process.env.PROMPT_FRAME_STUDY_ID = "prompt_frame_crossover_v2";
process.env.PROMPT_FRAME_OUTPUT_TOKEN_CAP = "1024";

await import("./generate-prompt-frame-crossover-v1.mjs");

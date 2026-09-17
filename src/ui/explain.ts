export type ExplainTopic = {
  id: string;
  label: string;
  short: string;
  summary?: string[];
  sections: {
    title: string;
    lines: string[];
    visualLines?: string[];
  }[];
};

export const EXPLAIN_TOPICS: ExplainTopic[] = [
  {
    id: "overview",
    label: "What this is",
    short: "paper-facing testbed overview",
    summary: [
      "Agent Interaction Lab runs controlled multi-agent LLM experiments.",
      "Each saved run links its setup, responses, memory operations, and final metrics.",
    ],
    sections: [
      {
        title: "Purpose",
        lines: [
          "The released paper asks when shared written memory helps agents correct mistakes and when it preserves repeated false claims.",
          "The testbed holds the agents, question, instructions, speaking order, and call budget fixed while changing the communication method.",
          "It also records every model call, retrieved statement, memory write, and final answer for audit.",
        ],
      },
      {
        title: "One run",
        lines: [
          "A run combines one experiment config, scenario, condition, roster, and seed or order schedule.",
          "The run directory contains summary.json for outcomes and trace.db for the full event record.",
        ],
      },
    ],
  },
  {
    id: "communication",
    label: "Communication methods",
    short: "shared memory, debate, personal memory",
    summary: [
      "The paper compares three ways that otherwise matched agents receive information.",
      "Shared and personal memory are not the same as live debate.",
    ],
    sections: [
      {
        title: "Shared memory",
        visualLines: ["agent -> written record -> later agents"],
        lines: [
          "Agents write conclusions to one common record. Later agents retrieve recent entries from that record.",
          "Under standard shared memory, neutral agents can read liar-agent statements, their own earlier entries, and entries written by other neutral agents.",
        ],
      },
      {
        title: "Restricted shared memory",
        visualLines: ["liar entries + own history -> neutral agent", "other neutral entries       -X-> neutral agent"],
        lines: [
          "The peer-visibility test keeps every liar-agent statement visible.",
          "It hides only statements written by other neutral agents, which isolates whether persuaded neutral agents contribute to further spread.",
        ],
      },
      {
        title: "Live debate and personal memory",
        lines: [
          "In live debate, agents exchange direct messages during the run rather than reading one persistent common record.",
          "With personal memory, agents retain only their own history and receive no peer messages.",
        ],
      },
    ],
  },
  {
    id: "roles-metrics",
    label: "Roles and metrics",
    short: "liar agents, neutral agents, FE, FE_t, AR",
    summary: [
      "The interface separates adoption by neutral agents from persistence by liar agents.",
      "That distinction prevents one all-agent average from hiding who changed.",
    ],
    sections: [
      {
        title: "Agent roles",
        lines: [
          "Liar agents are assigned to keep supporting the false claim in the controlled misinformation experiments.",
          "Neutral agents judge the question for themselves and may endorse, reject, or remain uncertain.",
          "Separate honest-mistake experiments begin with an error but do not require any agent to preserve it.",
        ],
      },
      {
        title: "Reported metrics",
        lines: [
          "FE is the fraction of all agents whose final answer endorses the false claim.",
          "FE_t is the fraction of neutral or other non-liar agents whose final answer endorses it.",
          "AR is the fraction of liar agents that still give their assigned false answer at the end.",
          "The TUI labels these as all-agent FE, non-liar FE_t, and liar retention where available.",
        ],
      },
    ],
  },
  {
    id: "evidence",
    label: "Paper evidence",
    short: "manifests, checksums, and calculations",
    summary: [
      "The paper claims 6,334 completed runs across three non-overlapping manifests.",
      "Use the Paper evidence screen or npm run verify:release to audit the release.",
    ],
    sections: [
      {
        title: "What is checked",
        lines: [
          "The base manifest rebuilds every encoded paper-table calculation directly from released traces.",
          "The late-appendix and open-model manifests list every selected run and SHA-256 checksum.",
          "The unified verifier checks counts, file presence, config dependencies, hashes, SQLite integrity, completion records, and the late-table aggregates.",
        ],
      },
      {
        title: "Commands",
        lines: [
          "npm run verify:release:quick checks coverage and recomputes reported aggregates.",
          "npm run verify:release additionally verifies every checksum and SQLite trace.",
          "The generated report is saved under analysis/release_audit.md and analysis/release_audit.json.",
        ],
      },
    ],
  },
  {
    id: "outputs",
    label: "Outputs and audit trail",
    short: "where to find each artifact",
    summary: [
      "A result is not just the value shown on screen.",
      "The released trace is the canonical source for the final state.",
    ],
    sections: [
      {
        title: "Run artifacts",
        lines: [
          "output/<run-id>/summary.json contains the cached summary used for browsing.",
          "output/<run-id>/trace.db contains the recorded run identity, model calls, agent states, metrics, retrievals, and memory writes.",
          "paper/*.json manifests connect table rows to exact run IDs and checksums.",
        ],
      },
      {
        title: "Canonical calculations",
        lines: [
          "When an old cached summary disagrees with the final trace state, the audit uses the final trace state and records the warning.",
          "The release verifier exits with a failure code if a claimed artifact, dependency, checksum, completion record, or reported aggregate does not match.",
        ],
      },
    ],
  },
];

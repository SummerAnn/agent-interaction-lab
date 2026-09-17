# Literature and Pre-Run Validation for Agent Society

Last updated: September 4, 2026

## September 4, 2026: Additional Multi-Agent Safety and Task Literature

This section separates papers that frame the safety problem from papers that
offer hard task designs. A citation here is not evidence that Agent Society has
replicated its result.

### Safety framing and group behavior

| Work | What it provides | Use in this project |
| --- | --- | --- |
| [Hammond et al. (2025), *Multi-Agent Risks from Advanced AI*](https://arxiv.org/abs/2502.14143) | A risk taxonomy that includes information asymmetries, network effects, destabilising dynamics, commitment problems, and multi-agent security. | Places false-belief persistence under information asymmetry and network dynamics. It does not claim that shared memory is always harmful. |
| [Becker et al. (2026), *Misinformation Propagation in Benign Multi-Agent Systems*](https://arxiv.org/abs/2606.16710) | Tests how misinformation introduced to otherwise cooperative LLM agents changes group performance; reports dependence on group composition and decision protocol. | Closest framing for the false-seeded runs. It supports making the number of initially misinformed agents and the aggregation rule explicit. |
| [Han et al. (2026), *Conformity Dynamics in LLM Multi-Agent Systems*](https://arxiv.org/abs/2601.05606) | Studies how topology and the balance between private and social weighting affect collective judgments in a misinformation task. | Supports topology as a separate variable and motivates measuring wrong consensus separately from final accuracy. |
| [YS et al. (2026), *Everyone Conforms, No One Believes*](https://arxiv.org/abs/2608.02758) | Tests public conformity despite private disagreement and evaluates whether one dissenting agent can break a false consensus. | Suggests a later task where the system records both each agent's private view and its public post. This is distinct from the current false-claim runs. |

### Hard task sources

| Work | Task design to borrow | What Agent Society would change |
| --- | --- | --- |
| [SILO-BENCH (Zhang et al., ACL 2026)](https://aclanthology.org/2026.acl-long.1354/) | Exact-answer tasks split across agents, with aggregation, multi-hop, and global-shuffle difficulty. | Use source cards whose correct conclusion requires two or more cards. Add an early false interpretation and later corrective cards, then test what the record retains. |
| [MAS-BENCH (Yang et al., Findings ACL 2026)](https://aclanthology.org/2026.findings-acl.1698/) | Distributed sorting where agents have local segments and communicate through broadcasts, peer messages, or a shared key-value store. | Adapt its explicit shared-state comparison: personal notes, a source-only record, and a record that mixes sources with agent conclusions. |
| [PeopleJoin (Jhamtani et al., Findings ACL 2025)](https://aclanthology.org/2025.findings-acl.916/) | Multi-user information gathering with necessary information distributed across 2 to 20 participants. | A source for scaling beyond six agents without changing the research question: who holds necessary evidence, whether it reaches the record, and whether the group uses it. |
| [MultiAgentBench (Zhu et al., ACL 2025)](https://aclanthology.org/2025.acl-long.421/) | Interactive collaboration tasks with star, chain, tree, and graph communication structures. | Supports the chat-topology extension, once the current chat execution and manipulation checks are repaired. |
| [Peng et al. (2025), *Communication and Verification in LLM Agents*](https://arxiv.org/abs/2510.25595) | Split-information Einstein-puzzle collaboration with an environment-based verifier. | A model for replacing the current direct GT-verification prompt with a separate checker that sees evidence but not the group answer. |
| [Lakara et al. (2024), *LLM-Consensus*](https://arxiv.org/abs/2410.20140) | Multi-agent misinformation detection with external retrieval and debate. | A later real-world task family: agents assess whether a claim fits its source context, while Agent Society tests how a saved record affects later assessment. |

### Reasoning-contagion task sources

| Work | What it found or supplies | Use in the GSM-Hard extension |
| --- | --- | --- |
| [GSM-Hard](https://huggingface.co/datasets/reasoning-machines/gsm-hard) | A collection of grade-school math reasoning problems with altered numbers, built to make superficial pattern matching less reliable than on the original GSM8K prompts. | Gives exact numeric answers for testing whether an early wrong calculation is passed through memory or discussion. Each selected problem still needs a direct single-agent accuracy check. |
| [Bertalanič and Fortuna (2026), *The Cost of Consensus: Isolated Self-Correction Prevails Over Unguided Homogeneous Multi-Agent Debate*](https://arxiv.org/abs/2605.00914) | On GSM-Hard and MMLU-Hard, homogeneous debate showed model-dependent conformity, including modal-answer adoption reported up to `85.5%`. | Motivates asking whether a wrong rationale remains influential after its author leaves when it is saved in a shared record. It studies debate, not persistent shared memory. |
| [Wan et al. (2026), *The Deliberative Illusion*](https://arxiv.org/abs/2606.03032) | Group discussion can lose facts while public positions converge. | Motivates saving the exact reasoning each agent writes or retrieves and checking whether the later group answer still uses the needed calculation. |

There are two different papers titled *The Cost of Consensus* in this review. The
GSM-Hard debate paper is [Bertalanič and Fortuna, arXiv:2605.00914](https://arxiv.org/abs/2605.00914).
The distributed-search paper already listed above is [Farr et al., arXiv:2605.06988](https://arxiv.org/abs/2605.06988).

### Task roadmap from this review

1. Finish and audit the current false-seed, correction, and source-exit reruns before adding another large family.
2. Build a small exact-answer split-evidence packet set using the SILO-BENCH idea: no one card settles the answer, while the full set does.
3. Add a public-versus-private response field only after the current trace report is complete. This would test conformity without redefining the current false-endorsement metric.
4. Replace direct GT verification with a blinded checker only as a separate study. The current GT-verification condition is a strong truth signal, not an independent external investigation.
5. Treat GSM-Hard as a separate reasoning-contagion family: it tests propagation of a wrong calculation, not whether a model remembers a familiar scientific fact.

## September 3, 2026: Bounded-Record Cascade Literature Review

### Review question

This review asks a narrow question: has prior work tested an LLM group in which early wrong private signals enter a bounded persistent shared record, later better private signals arrive, and traces show whether the later signals were stored, retrieved, and used in the final decision?

This is a targeted review of work published or posted from 2023 through September 2026. It is not a systematic review of every multi-agent or agent-memory paper.

### Directly relevant work

| Work | What it studies | Relation to Agent Society | What remains different |
| --- | --- | --- | --- |
| [Stasser and Titus (1985)](https://doi.org/10.1037/0022-3514.48.6.1467) | Human groups often discuss information already shared before discussion and information that supports their initial preference. | Gives the behavioral basis for private cards, initial views, and measuring whether a unique card enters group reasoning. | Human discussion, not persistent LLM memory or trace-level retrieval. |
| [Anderson and Holt (1997)](https://ideas.repec.org/a/aea/aecrev/v87y1997i5p847-62.html) | Sequential private signals and public choices can form information cascades. | Gives the early-signal and fixed-speaker-order design. | Public choices, not a shared retrieval store. |
| [HiddenBench (Li, Naito, and Shirado, 2025)](https://arxiv.org/abs/2505.11556) | LLM groups integrate asymmetric information in hidden-profile tasks. | Provides difficult private-information tasks and a group-choice evaluation. | Does not isolate bounded persistent-record retention versus agent opinions. |
| [InformativeBench (Liu et al., 2024)](https://arxiv.org/abs/2406.14928) | LLM agents coordinate under information asymmetry in a larger social network. | Supports information asymmetry as a real agent-system issue. | Focuses on routing information for task completion, not false-belief entrenchment. |
| [The Deliberative Illusion (Wan et al., 2026)](https://arxiv.org/abs/2606.03032) | Discussion can lose issue-critical facts while group stances converge. | Closest existing factual-loss result. Its fact-survival measurement motivates our write, retention, retrieval, and final-use traces. | Studies deliberative chat and context attrition, not an explicitly bounded asynchronous record with controlled early wrong signals. |
| [Misinformation Propagation in Benign Multi-Agent Systems (Becker et al., 2026)](https://arxiv.org/abs/2606.16710) | Misinformed agents can affect benign multi-agent systems; outcomes depend on composition and decision protocol. | Supports testing misinformation without hostile agent goals and keeping composition/protocol explicit. | Injects misinformation into debate; does not test record capacity or whether later private evidence is crowded out. |
| [The Cost of Consensus (Farr et al., 2026)](https://arxiv.org/abs/2605.06988) | Communication can yield confident but wrong group belief under partial observations. | Supports measuring final accuracy separately from convergence. | Distributed search and communication gating, not persistent-record retrieval. |
| [Physics of Agents (El et al., 2026)](https://arxiv.org/abs/2608.16578) | LLM communities show consensus, polarization, and conviction-building regimes. | Supports measuring belief trajectories and group convergence. | Models message interaction; it does not vary the content-retention rule of a shared memory store. |
| [Generative Agents (Park et al., 2023)](https://arxiv.org/abs/2304.03442) | 25 agents in a sandbox town store all observations in a memory stream, synthesize reflections, and retrieve relevant memories dynamically. Agents form beliefs, spread information through chance encounters, and coordinate plans (e.g., a Valentine's Day party) through memory-mediated social interaction. | Establishes the memory-stream architecture now used in deployed agent systems. Their three-part design (store → reflect → retrieve) directly parallels our shared record. Our results show this architecture is vulnerable: a single false observation entering the memory stream propagates through retrieval to every agent that queries related memories. Their reflection mechanism (condensing memories into higher-level insights) could either amplify false beliefs (by reinforcing them as "insights") or mitigate them (by surfacing contradictions). We do not test reflection. | Does not test whether record content creates a false-belief feedback loop. Does not compare memory-stream interaction with live debate. Does not seed adversarial observations. Their agents interact organically (walk around, bump into each other) rather than in controlled round-robin order. |
| [Constraint Drift (Li et al., 2026)](https://arxiv.org/abs/2605.10481) | Constraints can weaken across memory, delegation, and communication. | Provides the broader safety frame: information must stay available and enforceable throughout an agent trajectory. | A position paper, not an experiment on belief lock-in. |

### Review conclusion

The reviewed work establishes each ingredient separately: private information, sequential social influence, factual loss during group interaction, misinformation propagation, and persistent agent memory. I did not find a paper that combines all of them in one controlled LLM experiment with these four measurements:

- whether a correct private signal was written into the shared record;
- whether it remained after later writes;
- whether a later agent retrieved it;
- whether the final group decision used it.

That is the narrow contribution Agent Society can test. It should not claim to be the first work on misinformation, information cascades, hidden profiles, or agent memory.

### Consequences for the next task

- The task needs an explicit retention policy. A four-entry retrieval window alone is not a four-entry record.
- A first-in-first-out rule is a baseline, not a presumed lock-in mechanism: late correct information may replace early wrong information.
- The model must not receive a direct truth cue. The latent answer belongs only to the evaluator.
- Early wrong behavior must come from controlled private signals and speaker order, not role prompts or `falseClaimBias`.
- The task needs both a no-signal control near chance and a full-information control near ceiling before group cells are run.

This note is for deciding whether `Agent Society` is only a platform project or whether it can support a meaningful multi-agent safety paper.

The short answer is:

- yes, it can support a meaningful paper
- no, the contribution should not be framed as only "we built a platform"
- yes, there are still a few confounds to control before spending serious API budget

## Core framing

The strongest paper framing is:

> persistent shared memory is a causal social mechanism in multi-agent systems that can amplify, stabilize, and sometimes protect false belief from later correction

That is stronger than:

- we built a local multi-agent testbed
- we compared a few agent settings
- we reproduced misinformation spread in a toy setup

The platform matters because it makes the causal question testable, but the paper contribution should be about `epistemic failure in multi-agent systems`, not infrastructure alone.

## Current study inventory

There are `10` main numbered study families in the repo right now, plus `5` variants or legacy subsets.

Current status:

- `canonical`: study 1 memory benchmark, study 2 correction-policy benchmark
- `supporting`: study 1 scaling, study 1 model robustness, study 1b stronger memory-poisoning stress, study 3 topology, study 4 population mix, study 7 private evidence, study 8 source exit and observer, study 9 correction trust, study 10 seeded false memory
- `pilot`: study 5 open discussion, study 6 truthful collusion
- `deprecated`: old study 1 memory-mode subset, old study 2 timing-only subset

Why this matters:

- you do have `10` real study lines
- they are not all equally ready for paper use
- the canonical pair is the safest place to lead the paper
- the supporting studies help explain when the main pattern holds, breaks, or changes form
- the pilot studies are good for mechanism-building, but they should not carry the whole paper yet

## Settings check on the current study set

I think the overall settings are in decent shape now, but the study set is not flat. It has layers.

### Safe to run as benchmark lines now

- study 1 memory benchmark
- study 2 correction-policy benchmark
- study 7 private-evidence split
- study 8 source-exit and observer
- study 9 correction trust
- study 10 seeded false memory

Why:

- each one stays within a single interaction family
- each one has a clearer changed variable
- each one now has explicit benchmark metadata in the manifest

### Useful but should be treated as supporting checks

- study 1 scaling
- study 1 model robustness
- study 3 topology
- study 4 population mix
- study 1b stronger poisoning stress

Why:

- they help test scope, generalization, or stress
- they are not the cleanest first claim to lead with

### Still better treated as pilot studies

- study 5 open discussion
- study 6 truthful collusion

Why:

- richer interaction makes evaluation harder
- they rely more on citation-fidelity and discourse-style metrics
- study 6 still has a small seed count

### Legacy subsets to keep only for reference

- study1-memory-mode
- study2-correction-timing

Why:

- both are narrower older slices of stronger benchmarks now in the repo
- they are still useful for quick checks and historical comparison
- they should not be the paper-facing result set

## What the current literature says

## Real-source task origins

The paper-facing tasks now come from documented research records rather than invented examples. A task is not treated as usable simply because its sources are real: it must also fail a no-card control and pass a full-card control before it is given to a group of agents.

| Task or task family | Origin | Why it is in Agent Society | Current status |
| --- | --- | --- | --- |
| Public debt source-mapping task | Reinhart and Rogoff (2010); Herndon, Ash, and Pollin (2014); Panizza and Presbitero (2013, 2014) | First attempt to test whether a group can combine four separately held source summaries. | Retired from paper evidence. The one-card audit found answer-option shortcuts in six of twelve versions. |
| Ego-depletion packet | Baumeister et al. (1998); Hagger et al. (2016); Carter and McCullough (2014); Friese et al. (2019) | Candidate replication-reading task. | Rejected as a first group task: Haiku selected the qualified answer in `10/10` no-card calls. |
| Facial-feedback packet | Strack et al. (1988); Wagenmakers et al. (2016); Many Smiles Collaboration (2022); Coles et al. (2019) | Candidate replication-reading task with a narrow-versus-broad conclusion. | Rejected as a first group task: Haiku selected the qualified answer in `10/10` no-card calls. |
| STAP-cell packet | Obokata et al. (2014); Nature retraction (2014); De Los Angeles et al. (2015); Niwa (2016) | A simpler source-history check: original claim, retraction, and failed follow-up. | Candidate only. Likely useful as a floor check, but may be too easy. |
| LK-99 packet | Lee et al. (2023); Kumar et al. (2023); Habamahoro et al. (2024); IOP review (2024) | Candidate task about a viral early claim and later replication evidence. | Candidate only; needs no-card screening. |
| Chemotherapy-predictor retraction packet | Potti et al. (2006); Potti et al. retraction (2011); Institute of Medicine (2012); National Academies (2017) | Tests whether a shared record retains the later evidence that changes how an early positive study should be read. It is a source-reading task about a historical research record, not a medical decision task. | No cards: `0/30` selected an answer. All cards: `30/30` selected the supported answer. But the retraction card alone also selected it in `10/10`, so this packet is not a source-pooling task. Keep it for a later source-version or delayed-source study. |

### Chemotherapy-predictor source record

- Potti et al. (2006), *Genomic signatures to guide the use of chemotherapeutics*. The original paper reported genomic signatures intended to predict response to several chemotherapy drugs. [Nature Medicine](https://www.nature.com/articles/nm1491)
- Potti et al. (2011), retraction note. The authors stated that they could not reproduce crucial validation experiments and that corrupted validation data precluded conclusions about the signatures. [Nature Medicine](https://www.nature.com/articles/nm0111-135)
- Institute of Medicine (2012), *Evolution of Translational Omics*. The case review explains the reproducibility and data-method concerns around the predictors. [NCBI Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK202159/)
- National Academies (2017), *Fostering Integrity in Research*. Its case history describes the external reanalysis and later withdrawals. [NCBI Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK475955/)

The new packet uses these sources only to ask what can be concluded about the specific retracted signatures. It does not ask about a person's treatment or about genomic medicine in general.

### Blinded source-map version of facial feedback

The reviewed facial-feedback sources will also be used in a new source-map task. The agent sees four cards marked `F1` through `F4`, not the study name or author names. The full paper record still stores the sources. This is a training-data control: the agents must use the assigned source facts to map `F1` through `F4`, rather than recognizing a familiar replication story from the question alone.

The task comes from the same four sources listed above. It tests distributed source combination, not whether facial feedback is true or false in general.

The first blinded no-card screen was rejected because only answer position changed while the anonymous-label mapping stayed fixed. A repaired version shuffles the source-label mapping itself. In the repaired no-card screen, Haiku selected the intended map for only one of the three shuffled versions. The full-card control then selected the intended map in all `30/30` cells, with all planned calls and steps completed and zero parser fallbacks.

The task still fails the one-card requirement. With only `F2`, the direct-replication card, Haiku selected the complete intended map in `10/10` calls. With only `F4`, the multi-lab card, it also selected the complete intended map in `10/10` calls. The answer options still let one card identify the full mapping. The task is rejected before any group comparison. These runs document task construction, not a finding about how groups share sources.

### Public-debt one-card audit

The shuffled public-debt source-map packet also received the same audit on 2026-09-03: four one-card versions for each of three label arrangements, with ten fixed schedules per version (`120` cells). All `120/120` cells completed planned calls and steps, with zero parser fallback entries. The task failed. A/W4, all four B-card versions, and C/W4 selected the complete intended map in `10/10` schedules each. The other six one-card versions did not select it. Since temperature was `0`, these are repeated schedule checks rather than independent samples.

The earlier four-agent public-debt comparison is therefore retired from paper evidence. It remains a platform trace and task-design record, not a result about source sharing. Memory-mode runs now save the source IDs each agent saw, retrieved, and named in its response. The replacement task will use those traces when it scores a final conclusion.

## Harder Task Designs To Build Next

The current claim scenarios are useful for checking memory and trace machinery, but they often give one agent a sentence that settles the answer. The task families below require agents to combine pieces of a case, track who had which piece, and distinguish a source from another agent's conclusion.

### September 4, 2026: additional hard-task options

These are task families worth considering after the active false-seed grids
finish. They are not all equally suitable for the current paper. A task is
only ready for a group run after it passes three controls: no private cards,
each single card alone, and all required cards together.

| Task family | External basis | What an Agent Society version would ask | Exact check | Fit with the paper |
| --- | --- | --- | --- | --- |
| **Split-result scientific table** | [SCITAT](https://aclanthology.org/2025.findings-acl.199/) uses questions that require both scientific text and tables. | Agents receive a small generated study record: an effect table, an imbalance table, a design note, and a replication table. The group must choose the only conclusion supported by all of them. | The scenario generator computes the answer from the table values and study-design rule. | **Best next task.** It keeps the scientific setting, blocks reliance on familiar facts, and gives a real late-evidence and correction test. |
| **Multi-step data-analysis debugging** | [DSDBench](https://aclanthology.org/2025.emnlp-main.878/) contains multi-hop, multi-bug data-science debugging cases. | Each agent receives a failing test, a data summary, a code fragment, or a candidate patch. A false early diagnosis can be seeded; a later test result can refute it. | Run the supplied test suite or a small local checker against the selected patch. | Strong task, but a separate application domain. Build only after the scientific-table task works. |
| **Wrong-calculation persistence** | [GSM-Hard](https://huggingface.co/datasets/reasoning-machines/gsm-hard) and [Bertalanič and Fortuna (2026)](https://arxiv.org/abs/2605.00914). | Agents receive parts of a calculation and one early wrong derivation. The group must produce the exact numeric answer. | Numeric exact match and retrieval of the correcting calculation. | Already running. Useful as a reasoning extension, not a substitute for the scientific-claim result. |
| **Multi-turn misinformation resistance** | [MisinfoBench](https://aclanthology.org/2025.findings-emnlp.540/) tests discernment and resistance when misleading context accumulates over turns. | A false claim and later correction appear across a short conversation; agents must separate the correction from repeated earlier claims. | Answer key plus a check that the needed correction was retrieved. | Good external-validation family, but use held-out material and screen for training-data shortcuts. |
| **Private/public disagreement** | [social-deduction evaluation](https://aclanthology.org/2026.findings-acl.2043/) and [Conformity Dynamics](https://arxiv.org/abs/2601.05606). | Each agent records a private answer and a public post after seeing a false majority. | Difference between private accuracy, public endorsement, and final group choice. | A useful second paper direction. It studies conformity, not record persistence, so it should not be mixed into the main result now. |

#### Recommended next build: split-result scientific table

Build a generator for `20` to `40` small study records rather than hand-writing
another familiar case. Each record should contain four short cards:

1. a reported treatment difference;
2. a group-imbalance or measurement problem that changes how that difference
   should be read;
3. a replication or corrected analysis;
4. a true but non-decisive distractor.

The supported conclusion must require cards `2` and `3`; card `1` should make
the early wrong conclusion plausible, and card `4` must not settle the answer.
Put cards `2` and `3` with different agents. Seed the false interpretation as
an early agent conclusion, not as a fake source card. Then vary the existing
memory versus chat path, the time at which card `3` becomes available, and
whether the agent holding card `3` remains active.

This is harder for a concrete reason: an agent cannot answer by recalling a
known controversy or by reading one decisive sentence. The evaluator knows the
answer because it generated the numbers and study-design facts.

#### Do not build these as the next overnight grid

- Do not import a raw real-world source packet without the three controls.
  The earlier facial-feedback, public-debt, and chemotherapy packets showed
  why: a familiar story or one card can reveal the answer.
- Do not use Overcooked as a substitute. [Collab-Overcooked](https://aclanthology.org/2025.emnlp-main.249/)
  is valuable for interactive collaboration, but it changes the paper from
  epistemic safety to action coordination and requires a new environment.
- Do not use social deduction as the main task. It is useful for adversarial
  behavior, but it does not test whether a correct scientific signal survives
  in a group record.

### 10. Information-silo computation with an exact answer

**Zhang et al. (ACL 2026)**  
*SILO-BENCH: A Scalable Environment for Evaluating Distributed Coordination in Multi-Agent LLM Systems*  
https://aclanthology.org/2026.acl-long.1354/

Key result:

- It separates three kinds of distributed problems: simple aggregation, multi-hop mesh problems, and global-shuffle problems where the answer requires moving several private pieces to the right places.
- It reports a communication-reasoning gap: agents can exchange many messages without solving the distributed computation.

Task to adapt in Agent Society:

- Give each agent private pieces of a small scientific result table: sample sizes, effect directions, preregistration status, and a bias flag.
- Ask the group to decide one exact question, such as whether the evidence supports a reliable causal effect.
- Create three difficulty levels: one piece is enough; two pieces must be combined; or several pieces must be matched across agents before a conclusion is possible.
- Score the final answer exactly and record whether the required source pieces were ever visible to the deciding agent.

Why this is better than the current supplement scenario:

- no one sentence has to settle the answer;
- the ground truth can be generated from the cards rather than inferred from a vague real-world claim;
- it tests whether shared records carry the *right pieces* rather than merely changing agreement.

### 11. Hidden-profile scientific diagnosis

**Li, Naito, and Shirado (2025)**  
*HiddenBench: Assessing Collective Reasoning in Multi-Agent LLMs via Hidden Profile Tasks*  
https://arxiv.org/abs/2505.11556

Task to adapt in Agent Society:

- Give a group a scientific diagnosis or replication decision with six evidence cards.
- Put the two decisive cards with different agents; give everyone several plausible but non-decisive cards.
- Add an early majority view based on the plausible cards, then make the decisive cards available only through the agents who hold them.
- Measure whether the group discovers, repeats, and uses the decisive cards before deciding.

This is the closest fit to the original memory question. A raw shared record can fill with early opinions; a source-aware record should make it easier to find the decisive cards later. Unlike the current setup, the answer cannot be obtained from a single late source alone.

### 12. Source-isolated verification task

**Li et al. (ACL 2026)**  
*MARCH: Multi-Agent Reinforced self-Check for Hallucination*  
https://aclanthology.org/2026.acl-long.1828/

Key idea:

- Their checking agent evaluates source evidence without seeing the original model answer, avoiding self-confirmation.

Task to adapt in Agent Society:

- One agent makes an early scientific recommendation.
- A separate checker receives the source cards but not that recommendation.
- The group later receives the checker result and a record of earlier agent opinions.
- Compare a record that keeps the checker evidence separate with one that mixes it into prior group opinions.

This gives a concrete safety question: does a group preserve independent checking, or does its earlier consensus absorb the check into the same social record?

### 13. Forecasting from split evidence

**Li et al. (2026)**  
*Diverse Evidence, Better Forecasts: Multi-Agent Deliberation Under Information Asymmetry*  
https://arxiv.org/abs/2607.01661

**Zhang et al. (2024)**  
*MIRAI: Evaluating LLM Agents for Event Forecasting*  
https://arxiv.org/abs/2407.01231

Task to adapt in Agent Society:

- Turn each case into a binary forecast with a known later outcome.
- Give different agents separate time-stamped reports, with one older report pointing in the wrong direction and later reports changing the picture.
- Score Brier score, final accuracy, calibration, use of the latest evidence, and whether repeated early forecasts crowd out later reports.

This is harder and closer to real information flow, but it needs a curated dataset. It should be a later task family, not the next overnight experiment.

### Recommendation

Build the hidden-profile scientific diagnosis task next. It gives Agent Society a hard but fully controllable problem with exact answers, private evidence, distractors, and a natural role for source-aware memory. Use the information-silo task as the broader task family after the first diagnosis version works. Keep real-world forecasting for later because data curation and leakage control are larger projects.

### 1. Big-picture multi-agent safety framing

**Hammond et al. (February 19, 2025)**  
*Multi-Agent Risks from Advanced AI*  
https://arxiv.org/abs/2502.14143

Why it matters:

- It gives the broad safety taxonomy for the area.
- It identifies `miscoordination`, `conflict`, and `collusion` as core failure modes.
- It identifies `information asymmetries`, `network effects`, `selection pressures`, `destabilising dynamics`, `commitment and trust`, `emergent agency`, and `multi-agent security` as major causal factors.

What it validates in Agent Society:

- the project is clearly inside multi-agent safety
- the current design is especially relevant to `information asymmetries`, `network effects`, `destabilising dynamics`, and `multi-agent security`

What it does not justify yet:

- broad claims about the whole multi-agent safety space
- strong claims about conflict, bargaining, or emergent agency

### 2. Benign groups can still propagate falsehood

**Becker et al. (June 15, 2026)**  
*Misinformation Propagation in Benign Multi-Agent Systems*  
https://arxiv.org/abs/2606.16710

Key result:

- misinformation persists even in benign multi-agent systems
- multi-agent debate reduces some degradation relative to single-agent prompting
- robustness depends on group composition and decision protocol
- consensus can be more stable than voting under peer pressure

What it validates in Agent Society:

- your main story does not require malicious agents
- contamination plus otherwise normal agents is a legitimate setup
- composition, protocol, and correction are real causal levers

### 3. Selective truth can still manipulate group belief

**Hu et al. (January 4, 2026)**  
*Lying with Truths: Open-Channel Multi-Agent Collusion for Belief Manipulation via Generative Montage*  
https://arxiv.org/abs/2601.01685

Key result:

- colluding agents can steer beliefs using only truthful fragments
- reported attack success reaches `74.4%` for proprietary models and `70.6%` for open-weight models
- stronger reasoning models can be more vulnerable
- downstream judges can also be deceived after the false belief is propagated

What it validates in Agent Society:

- study 6 is not a side experiment; it is tied to a serious live question in the field
- selective emphasis and omission are enough to matter, even without fake evidence
- source lineage and testimony adoption are worth tracing explicitly

### 4. Topology changes what propagates

**Shen et al. (May 29, 2025)**  
*Understanding the Information Propagation Effects of Communication Topologies in LLM-based Multi-Agent Systems*  
https://arxiv.org/abs/2505.23352

Key result:

- communication topology causally changes whether good or bad information spreads
- moderately sparse topologies can suppress error propagation while preserving useful diffusion

What it validates in Agent Society:

- study 3 is important, not cosmetic
- topology should be treated as a first-class experimental variable
- dense communication is not automatically better

### 5. LLM societies can herd rather than aggregate information

**Liu et al. (July 4, 2026)**  
*Social Networks of LLM Agents*  
https://arxiv.org/abs/2607.03695

Key result:

- graph structure alone is not enough; effective influence depends on attention
- narrow attention causes herding
- under herding, effective sample size can stay bounded even as society size grows

What it validates in Agent Society:

- a false consensus result is meaningful even if many agents are present
- scale-up experiments should not assume larger societies automatically improve truth recovery
- memory retrieval limits and local visibility are scientifically important

### 6. Distributed truth recovery is fragile

**Li, Naito, and Shirado (May 15, 2025)**  
*HiddenBench: Assessing Collective Reasoning in Multi-Agent LLMs via Hidden Profile Tasks*  
https://arxiv.org/abs/2505.11556

Key result:

- groups fail to integrate distributed information reliably
- scaling and stronger reasoning do not reliably solve collective reasoning failure

What it validates in Agent Society:

- private evidence is a serious line of work, not an extra feature
- study 7 can contribute to the `information asymmetry` part of multi-agent safety

### 7. A single deceptive source can derail fact recovery

**Yan et al. (August 4, 2026; revised August 13, 2026)**  
*When Truth Is Distributed: Misinformation Derails Collective Fact Recovery in LLM-Based Multi-Agent Systems*  
https://arxiv.org/abs/2608.03421

Key result:

- aggregate truth recovery drops from `72.50%` to `14.17%` when controlled deception is introduced
- false testimony is adopted more readily than truthful testimony
- false testimony propagates to higher orders
- false influence persists after the deceiver exits
- observers suppress incorrect consensus but do not restore truth recovery

What it validates in Agent Society:

- source exit and observer studies are directly relevant
- adoption tracing and lineage tracing are not optional if you want a strong paper
- distributed information plus memory is a strong second paper direction

### 8. Harness design is part of safety, not just plumbing

**Wang et al. (May 18, 2025)**  
*Beyond Frameworks: Unpacking Collaboration Strategies in Multi-Agent Systems*  
https://arxiv.org/abs/2505.12467

Why it matters:

- it argues that collaboration strategy matters more than framework branding
- it studies governance, participation control, interaction dynamics, and dialogue-history management
- it explicitly measures both task quality and compute efficiency

What it validates in Agent Society:

- building a controllable local harness instead of extending a large production system is the right move
- your controllability story is methodologically relevant, not just practical

### 9. Memory-heavy agents are more exploitable

**Dash et al. (June 3, 2026)**  
*From Untrusted Input to Trusted Memory: A Systematic Study of Memory Poisoning Attacks in LLM Agents*  
https://arxiv.org/abs/2606.04329

Key result:

- persistent memory creates a long-term attack surface
- agents that write and retrieve memory more aggressively are more exploitable

What it validates in Agent Society:

- your memory-focused design is safety-relevant
- retrieval policy and write policy are part of the scientific mechanism, not implementation details

### 10. Classical consensus guarantees do not transfer automatically

**Anand and Pappas (June 12, 2026)**  
*Resilient Consensus in Agentic AI*  
https://arxiv.org/abs/2606.15024

Key result:

- LLM agents can fail to reach agreement even when classical consensus theory says agreement should be possible
- classical resilient consensus filters improve agreement

What it validates in Agent Society:

- correction, trust, and communication structure should be studied as design interventions
- your system can contribute by showing when epistemic recovery fails before formal filters are added

### 11. Visibility and logging are part of governance

**Chan et al. (January 23, 2024)**  
*Visibility into AI Agents*  
https://arxiv.org/abs/2401.13138

Why it matters:

- it argues for `agent identifiers`, `real-time monitoring`, and `activity logging`
- it treats monitoring as necessary for accountability in agent deployments

What it validates in Agent Society:

- trajectory logs, retrieval traces, and memory lineage support governance-relevant evaluation
- `trace.db` is part of the research contribution

### 12. Memory governance is itself a safety question

**Cuadros et al. (May 5, 2026)**  
*Governed Collaborative Memory as Artificial Selection in LLM-Based Multi-Agent Systems*  
https://arxiv.org/abs/2605.04264

Why it matters:

- it argues that the real design question is not only recall quality
- it asks which memories become shared institutional state, which stay local, and which get rejected or revised

What it validates in Agent Society:

- the project is not only about memory storage
- provenance, selection, revision, and correction are part of the safety mechanism
- this is one of the strongest papers for the idea that shared memory can become a social institution inside an agent group

### 13. Provenance-preserving shared memory is an active design target

**Rezazadeh et al. (May 23, 2025)**  
*Collaborative Memory: Multi-User Memory Sharing in LLM Agents with Dynamic Access Control*  
https://arxiv.org/abs/2505.18279

Why it matters:

- it introduces private and shared memory tiers with explicit provenance and access control
- it treats provenance as something that should remain attached to memory fragments

What it validates in Agent Society:

- provenance-visible versus provenance-hidden memory is a real experiment line, not an invented one
- your next step can be to test what happens when source information is preserved versus stripped away

### 14. Delayed correction can destabilize belief dynamics

**Itkin (June 25, 2026)**  
*Delayed Verification Destabilizes Multi-Agent LLM Belief: Instability Thresholds and Optimal Corrector Placement*  
https://arxiv.org/abs/2606.27409

Why it matters:

- it shows that correction is not only about whether a verifier exists
- timing and placement of correction can change the whole group dynamic

What it validates in Agent Society:

- study 2 and study 9 are on solid ground
- correction timing, correction strength, and who receives corrective influence are real causal variables

### 15. Correlated model errors limit naive model-diversity claims

**Kim et al. (June 9, 2025)**  
*Correlated Errors in Large Language Models*  
https://arxiv.org/abs/2506.07962

Why it matters:

- it shows that different models often fail in correlated ways
- using multiple model families does not automatically give real epistemic diversity

What it validates in Agent Society:

- study 1 model robustness should not be read as "different vendors solve the problem"
- if two model families behave similarly, that can itself be a meaningful result

### 16. Secret coordination risk matters even before overt falsehood

**Motwani et al. (February 12, 2024)**  
*Secret Collusion among Generative AI Agents*  
https://arxiv.org/abs/2402.07510

Why it matters:

- it formalizes hidden coordination and hard-to-detect communication among agents
- it frames collusion as a safety and security issue even when it is not obvious in surface outputs

What it validates in Agent Society:

- visible versus hidden collusion conditions are worth separating
- study 6 can later grow from selective disclosure into harder hidden-coordination settings

### 17. Collusion is not just a toy problem

**Fish et al. (March 31, 2024)**  
*Algorithmic Collusion by Large Language Models*  
https://arxiv.org/abs/2404.00806

Why it matters:

- it shows that LLM agents can coordinate in undesirable ways in market-like settings
- it is strong external motivation for taking collusion seriously as a systems problem

What it validates in Agent Society:

- even if your current study 6 is not market-based, collusive steering is a real multi-agent safety problem
- selective truthful steering is a believable first mechanism, not an artificial one

### 18. Group-level patterns can be studied as dynamics, not only task scores

**El et al. (August 17, 2026)**  
*Physics of Agents: Statistical Mechanics Predicts Collective Behavior of AI Agents*  
https://arxiv.org/abs/2608.16578

Why it matters:

- it studies consensus, polarization, and collective drift as system behavior
- it treats group trajectories themselves as meaningful scientific objects

What it validates in Agent Society:

- consensus speed, diversity collapse, and recovery shape are worth plotting directly
- your memory map, claim matrix, and trajectory views are part of the science, not only UI

## What Agent Society can claim now

If you keep the claim narrow, the platform can support a meaningful result such as:

1. Shared memory increases false-belief persistence relative to personal memory under otherwise fixed conditions.
2. Correction success depends strongly on timing, trust, and intervention design.
3. Distributed information and source-grounded discussion reveal additional failure modes beyond plain memory sharing.
4. Multi-agent epistemic failure can emerge without explicit malicious goals.

That is already a real contribution.

## What Agent Society should not claim yet

Do not overclaim:

- that it covers all of multi-agent safety
- that it captures strategic conflict in general
- that it gives a general benchmark for emergent agency
- that it solves governance or mitigation
- that all false-belief spread is caused by shared memory alone

## Implementation strengths already present

These parts are already good and should be preserved:

- `initialBeliefStates` and `initialMemoryEntries` are separate, so belief seeding and memory seeding are not fully bundled
- per-agent evidence visibility exists through `visibleToAgentIds`
- triggered correction exists through endorsement-threshold timing
- `testimony_adoptions` and `claim_lineage` are already being written in memory mode
- observer and source-exit variants already exist in the distributed rosters
- token usage is logged in the LLM memory path

Relevant files:

- `src/engine/core.ts`
- `src/scenario/access.ts`
- `src/engine/backends/memoryMode.ts`
- `src/memory/retrieve.ts`

## Confound audit before spending serious Claude budget

This is the most important part of the note.

### Confound 1: shared-memory retrieval weighting

This confound has been removed.

`src/memory/retrieve.ts` now treats endorse and reject memory entries symmetrically when computing memory signal.

Why this matters:

- the shared-versus-personal comparison is no longer mechanically tilted toward endorsement
- a false-lock-in result now has to come from seeding, retrieval, interaction, and correction dynamics rather than a hardcoded memory boost

Remaining implication:

- keep this weighting neutral unless you intentionally introduce a separate ablation on memory amplification

### Confound 2: heuristic and LLM modes are still different, but the main write asymmetry is fixed

The heuristic memory path now writes strong `reject` states as well as strong `endorse` states, so it no longer accumulates only pro-claim focus memories by construction.

Why this matters:

- heuristic mode is now closer to the LLM memory path
- basic memory-direction comparisons are cleaner for testing and smoke runs

Remaining implication:

- for the paper, still use LLM runs only
- keep heuristic mode for testing or UI demos
- do not mix heuristic and LLM outputs in reported scientific results

### Confound 3: cross-mode budgets are not directly comparable

Memory mode and chat mode do not use `maxModelCalls` in the same way.

- in memory mode, one active agent updates one step at a time
- in chat mode, all active agents may speak across several chat rounds inside one step

Why this matters:

- the same nominal budget does not mean the same amount of interaction
- cross-mode comparisons can mix causal effects of memory/chat with causal effects of communication volume and compute

Implication:

- compare `memory` conditions against other memory conditions
- compare `chat` conditions against other chat conditions
- if you compare across interaction modes, normalize by token usage and communication volume and report it explicitly

### Confound 4: the main metric is still coarse

`distanceFromGroundTruth` is currently a mismatch score over structured stances, not a rich semantic distance.

Why this matters:

- it is fine for a first controlled paper
- it is not enough for a strong claim about nuanced belief quality or evidence use

Implication:

- lead with endorsement, recovery, persistence, and testimony-adoption metrics
- treat `distanceFromGroundTruth` as a secondary summary metric

### Confound 5: keep seeding fixed across within-study comparisons

The platform now supports separate initial beliefs and initial memory entries, which is good.

Why this matters:

- if role mix, seed intensity, and memory condition change together, you lose causal clarity

Implication:

- within each benchmark, hold the scenario and seed design fixed unless the study is explicitly about those variables

## What I would trust as a first paper result

I would trust the following as a meaningful first result if the paper uses only LLM runs:

> Under fixed scenario, agent roster, and seed design, persistent shared memory increases false-belief persistence and slows recovery relative to personal memory, while correction effectiveness depends strongly on timing and trust.

That is narrow, clean, and relevant.

## Best contribution stack

The strongest contribution stack is:

1. `Conceptual`: shared memory is epistemic infrastructure, not just storage
2. `Empirical`: false-belief persistence depends on memory regime, correction timing, topology, trust, and evidence distribution
3. `Methodological`: operator-controlled tracing makes process-level evaluation possible
4. `Governance`: memory and retrieval logs support visibility and auditability

## Recommended pre-run policy

Before large experiments:

1. Use only LLM mode for paper results.
2. Keep comparisons within one interaction family unless budgets are normalized carefully.
3. Report token usage, model family, seeds, and exact scenario bundles for every benchmark.
4. Prioritize studies 1, 2, 3, 6, and 7 for the strongest paper story.

## Harder task roadmap

If you want `Study 1` to feel harder in a scientifically meaningful way, the best move is not to add more false claims. The best move is to make the truth harder to assemble.

### Harder task family 1: split-truth integration

This is the strongest next task family for the current platform.

Why:

- `HiddenBench` and `When Truth Is Distributed` both show that groups struggle when no single agent sees the full truth.
- This creates a setting where `memory regime` is a real causal lever rather than a cosmetic config toggle.

What to build:

- more `distributed-*` scenarios where one early misleading fragment is visible to the contamination path
- one or two critical corrective facts visible only to different specialists
- one distractor fact that is true but not decisive

What it tests:

- whether shared memory helps assemble truth
- whether shared memory also amplifies early false testimony
- whether verification helps the group integrate distributed evidence instead of just suppressing noise

Best current paper links:

- `HiddenBench: Assessing Collective Reasoning in Multi-Agent LLMs via Hidden Profile Tasks`
  https://arxiv.org/abs/2505.11556
- `When Truth Is Distributed: Misinformation Derails Collective Fact Recovery in LLM-Based Multi-Agent Systems`
  https://arxiv.org/abs/2608.03421

### Harder task family 2: source-exit persistence

Why:

- a stronger safety result is not only "false belief spreads"
- it is "false belief keeps moving after the original source is gone"

What to build:

- scenarios where the contamination agent is active only in early steps
- later agents can only inherit the falsehood through memory or testimony traces
- compare baseline versus source-exit rosters

What it tests:

- whether the memory store itself becomes the harmful actor
- whether later correction can unwind inherited false memory after the source disappears

Best current paper link:

- `When Truth Is Distributed: Misinformation Derails Collective Fact Recovery in LLM-Based Multi-Agent Systems`
  https://arxiv.org/abs/2608.03421

### Harder task family 3: topology under asymmetric information

Why:

- topology matters more when information is local and incomplete
- a fully connected graph may spread both truth and error too quickly

What to build:

- ring, chain, star, and fully connected variants of distributed scenarios
- keep the same evidence split and same correction trigger
- compare direct chat and memory-mediated sharing separately

What it tests:

- whether sparse structures slow misinformation enough for corrective evidence to catch up
- whether some topologies preserve diversity without preventing truth recovery

Best current paper links:

- `Understanding the Information Propagation Effects of Communication Topologies in LLM-based Multi-Agent Systems`
  https://arxiv.org/abs/2505.23352
- `Social Networks of LLM Agents`
  https://arxiv.org/abs/2607.03695

### Harder task family 4: truthful selective steering

Why:

- the next safety step after explicit falsehood is manipulation using only true fragments
- this is harder and more interesting than simple contamination

What to build:

- a subgroup with access to only genuine source cards
- the subgroup can selectively repeat favorable evidence while omitting decisive contrary evidence
- no fabricated claims allowed

What it tests:

- whether the group confuses repeated true fragments with overall truth
- whether citation fidelity can still degrade even when all cited facts are individually real

Best current paper link:

- `Lying with Truths: Open-Channel Multi-Agent Collusion for Belief Manipulation via Generative Montage`
  https://arxiv.org/abs/2601.01685

### Harder task family 5: memory poisoning threshold

Why:

- this is still useful, but it should be framed as a stress test, not the main causal benchmark

What to build:

- stronger dose-response ladders
- mixed seed credibility, not only repeated seed count
- delayed verification instead of immediate corrective clarity

What it tests:

- how much repeated false memory is needed before recovery breaks
- whether verification shifts the threshold or only weakens the slope

Best current paper link:

- `From Untrusted Input to Trusted Memory: A Systematic Study of Memory Poisoning Attacks in LLM Agents`
  https://arxiv.org/abs/2606.04329

## Recommended order for harder tasks

1. Expand `Study 1` around `distributed-*` scenarios.
2. Add one `source-exit` version of each distributed scenario.
3. Add one topology variant on top of the distributed family.
4. Keep `memory poisoning` as a stress-test line, not the headline benchmark.
5. Use `truthful collusion` as the next-paper or later-study direction once the memory story is stable.

## Bottom line

`Agent Society` can contribute meaningfully if the paper is framed as a study of `epistemic failure and recovery in multi-agent systems`, not just as a software artifact.

The main remaining risk is not lack of novelty. It is avoidable confounding in the current implementation.

The shared-memory weighting confound is fixed. The next practical risk is mixing heuristic and LLM results or comparing chat and memory runs without normalizing budget.

It should be a structural pass on:

- config schema
- prompt construction
- evidence access control
- trace database tables
- run summaries

That is the shortest path from the current harness to a stronger multi-agent safety paper.

## August 29, 2026 literature tighten

I checked a second pass of recent primary-source papers to see where the clean gap is now.

What looks already covered:

- benign misinformation spread
- distributed truth-recovery failure
- topology effects
- truthful collusion
- single-agent memory poisoning
- source-exit persistence under deceptive testimony

That means the cleanest contribution is probably not:

- "shared memory is harmful"
- "LLM societies can spread falsehood"
- "agent groups fail under asymmetric information"

Those are all too broad now.

## Better gap for Agent Society

The better gap is:

> when does a shared record stop being a communication aid and start becoming a source-laundering mechanism

I think this is where `Agent Society` can say something sharper than the current papers.

`Misinformation Propagation in Benign Multi-Agent Systems` shows that false context can persist in debate.  
https://arxiv.org/abs/2606.16710

`Systematic Failures in Collective Reasoning under Distributed Information in Multi-Agent LLMs` shows that agents converge too early on shared evidence and leave hidden facts unexplored.  
https://arxiv.org/abs/2505.11556

`When Truth Is Distributed` shows that false testimony can keep influencing the group after the original source exits.  
https://arxiv.org/abs/2608.03421

`Collaborative Memory` shows that memory design can include private/shared tiers, provenance, and access controls.  
https://arxiv.org/abs/2505.18279

`Delayed Verification Destabilizes Multi-Agent LLM Belief` shows that delayed correction can create instability and that who gets correction budget matters.  
https://arxiv.org/abs/2606.27409

Taken together, these suggest a tighter paper question:

- not only whether false belief spreads
- but whether memory changes the `status` of a claim from "someone said this" to "the group knows this"

I think this is also the cleanest way to tie several study families together:

- study 1 asks whether shared memory helps or hurts when truth is distributed
- study 2 asks whether correction can stop a claim from settling into group record
- study 8 asks whether the record keeps carrying the claim after the original source is gone
- study 9 asks whether recovery depends on whether agents trust correction enough to revise that record
- study 10 asks how much bad inherited record the group can absorb before recovery breaks

## Candidate safety issue

I think the most promising new issue to define is:

### Source laundering through shared memory

Working definition:

- a claim enters the group from a weak, partial, or misleading source
- repeated storage and retrieval strip away source fragility
- later agents treat the claim as community record rather than contested testimony
- after that shift, correction has to fight the memory system itself, not only the original speaker

Why this is not the same as nearby papers:

- it is not just `memory poisoning`, because the key question is social re-endorsement and source detachment across agents, not only one poisoned memory write
- it is not just `collusion`, because the effect can happen without coordinated attackers
- it is not just `topology`, because the key mechanism is transformation of source status inside shared memory
- it is not just `distributed information failure`, because the distinctive outcome is that the wrong claim becomes normalized as group record

If you want a short paper phrase, this is the one I would test:

- `source laundering in shared agent memory`

## What Agent Society would need to show

To make that a real result, I think the paper needs three lines together.

### 1. Provenance loss changes belief more than raw exposure alone

Hold fixed:

- same scenario
- same number of false mentions
- same roster
- same model

Change only:

- shared memory with explicit source/provenance shown
- shared memory with source stripped or downplayed
- personal memory baseline

If source-stripped shared memory produces more later endorsement than provenance-preserving shared memory, that is already a clean result.

### 2. The effect survives source exit

This is the stronger test.

If the original low-quality source leaves, but the claim still circulates through memory and later agents keep endorsing it, then the harmful object is no longer only the speaker. It is the stored group record.

### 3. Correction works differently once laundering has happened

This is where the correction studies matter.

Early correction may stop laundering before the claim hardens into group record.

Late correction may still improve final belief somewhat, but fail to reverse adoption once the source has been abstracted away.

That would connect your memory and correction results into one story instead of two separate studies.

## New measurements worth adding

If the paper is about source laundering, the most useful extra measurements are:

- `source fidelity`: how often later endorsements still cite the original source correctly
- `source detachment rate`: how often a claim is repeated without source attribution after first entering shared memory
- `post-exit adoption`: how often endorsements occur after the originating agent is no longer active
- `correction elasticity`: how much endorsement drops once correction arrives, conditioned on whether source provenance is still visible

These are stronger for this paper than adding many more generic accuracy metrics.

## Best literature-backed story right now

After this second pass, I think the strongest truthful story is:

- multi-agent safety is not only about direct deception or bad outputs
- it is also about what the group turns into common record
- distributed information makes shared memory genuinely useful in some settings
- the same mechanism can also strip source fragility away from weak claims
- once that happens, the group may keep carrying the claim even after the original source is gone

That is a better contribution than "I built a platform" and narrower than "shared memory is bad."

## Best next experiments if the goal is novelty

1. Add a provenance-visible versus provenance-hidden memory condition inside the distributed-evidence family.
2. Rerun source-exit with those provenance conditions.
3. Rerun early versus late correction on top of that same setup.
4. Add one observer condition to see whether outside observation helps only when source provenance remains visible.

If those runs separate cleanly, I think you have a sharper paper than a generic memory benchmark.

## Real Source-Packet Task Design: September 2, 2026

Three papers shape the next real-source study design:

- `HiddenBench` turns the hidden-profile problem into an LLM-group evaluation: different agents hold different facts, and the group must combine them to select the right answer. It supports the private-source part of Agent Society, but our packets will use real cited scientific records rather than custom fact sets. [Li, Naito, and Shirado (2025)](https://arxiv.org/abs/2505.11556)
- `InformativeBench` studies agent collaboration when different agents hold different user information. It supports treating uneven source access as a variable rather than assuming all agents start with the same context. [Tang et al. (2024)](https://arxiv.org/abs/2406.14928)
- `Should We Be Going MAD?` finds that multi-agent debate does not reliably beat simpler strategies. This is why every Agent Society packet needs a full-packet single-agent reference, not only comparisons among group record rules. [Smit et al. (2024)](https://proceedings.mlr.press/v235/smit24a.html)

The planned hard tasks are not about making a question confusing for its own sake. Each one isolates a specific group failure: failure to combine two private sources, using a claim beyond its source’s scope, counting repeated opinions as separate evidence, or failing to revise after a later high-quality source appears. The packet plan, existing-scenario overlap map, and source links are in `paper/REAL_SOURCE_PACKET_CANDIDATES.md`.

Further task-design references:

- `PaperMind` separates scientific-paper reasoning into experimental interpretation, cross-source evidence reasoning, and critique. It supports adding study-design reading and cross-paper comparison tasks after the first source-packet grid. [PaperMind (2026)](https://arxiv.org/abs/2604.21304)
- `MultiAgentBench` includes strategic information sharing and trust-polarized collaboration. It supports a later task in which all statements may be true but a subgroup selectively repeats only the favorable ones. [MultiAgentBench (2025)](https://aclanthology.org/2025.acl-long.421.pdf)
- Kraidia et al. test adversarial persuasion in multi-agent LLM debate. It supports measuring whether repeated agent statements gain influence without adding source support. [Kraidia et al. (2026)](https://www.nature.com/articles/s41598-026-42705-7)
- Causal-benchmark reviews warn that a model can appear to reason from study design when it is actually retrieving familiar associations. This supports no-source, full-packet, and missing-card references in any causal source packet. [Yang et al. (2024)](https://arxiv.org/abs/2407.08029)

## Current Project Status: September 2, 2026

The source-laundering line above is a future research direction, not the current paper result. The completed private-evidence exact-choice runs used invented packets and are software checks only: they confirm that different agents can begin with different cards and that the code can score a group choice. They are not paper evidence. The replacement protocol uses reviewed, real source packets with an original paper, later evidence, and a review or retraction record. See `paper/REAL_SOURCE_PACKET_CANDIDATES.md`. Ego depletion and facial feedback have schema-valid drafts, but both failed their no-source gates: Haiku selected the qualified answer in all `10` calls without source cards for each topic. The next packet must be less familiar and pass the same gate before testing whether repeated agent opinions interfere with use of source cards.

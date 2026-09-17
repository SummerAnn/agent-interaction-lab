# What the completed experiments jointly show

This note separates verified observations from interpretation. It uses the
current table-to-run manifest, the 216-run peer-visibility audit, and direct
queries of the SQLite traces. It does not add new model calls.

## Data status

- The paper manifest resolves every reported table row to exact run IDs.
- It currently selects 5,437 unique completed runs and reports no manifest
  errors. Warnings identify known legacy summary fields; the paper uses final
  SQLite states when those fields disagree.
- The peer-visibility experiment contains all 216 planned runs. Every run has
  the expected agents, one claim, 18 completed model calls, and the correct
  speaking-order/repetition identifier. The restricted condition contains no
  accidental retrievals from another neutral agent.
- The experiments use fixed questions, models, instructions, and speaking
  orders. Repeated API calls are useful robustness checks, but they are not
  independent samples from a population of models or tasks.

## 1. Shared memory preserves social evidence as well as task evidence

The helpful and harmful experiments point to the same underlying property.

When one agent begins with an honest mistake and can revise it, the final
false-answer rate is 0.167 with personal memory and 0.087 with shared memory
across four questions and ten runs per question. In a separate experiment in
which four of six agents begin wrong but can revise, a shared record containing
evidence and evolving agent statements ends at 0.004. A record containing only
the evidence ends at 0.092. Corrected statements therefore help later agents.

When four agents are required to keep supporting a false claim, the same
persistence becomes harmful. In the primary matched Haiku comparison, the two
agents without an assigned answer give 22 false final answers out of 24 with
shared memory and none with personal memory or live debate.

The paper's central idea can therefore be stated without invoking generic
``conformity'': a persistent record gives later agents both task information
and a history of other agents' judgments. That history can carry a correction,
or it can make copied support appear stronger than it is.

## 2. The false answers form cascades within runs

The ratio experiment contains 36 shared-memory runs at each liar-agent count.

| Liar agents | No neutral agent gives the false answer | Some do | All do |
|---:|---:|---:|---:|
| 1 of 6 | 36 | 0 | 0 |
| 2 of 6 | 30 | 3 | 3 |
| 3 of 6 | 2 | 2 | 32 |
| 4 of 6 | 7 | 0 | 29 |

The two-liar rows are especially diagnostic. The individual false-answer rate
is 0.125. If the four neutral agents behaved independently at that rate, fewer
than 0.01 of the 36 runs would be expected to end with all four giving the
false answer. Three runs do. The corresponding expected number of partial runs
is 14.9, while only three are observed. This is a descriptive benchmark, not a
hypothesis test, but it shows why an average over final answers misses the
shape of the result.

Across affected runs, complete spread occurs in 3/6 runs with two liar agents,
32/34 with three, and 29/29 with four. The result is closer to a run-level
transition than to several independent agents each changing with a fixed
probability.

## 3. The traces and the visibility intervention support a two-stage account

In the original ratio traces, the first neutral agent to give the false answer
has usually read at least four liar-written endorsements. Every second or later
neutral-agent change follows retrieval of a false statement written by a
neutral agent who had already changed: 12/12 later changes with two liar agents,
68/68 with three, and 29/29 with four. This sequence motivated a controlled
test; it is not itself a causal claim.

The controlled test keeps every liar-written statement visible but hides
statements written by the other neutral agents. At a three-three split, false
final answers fall from 89/108 to 73/108. Runs with any false answer move only
from 30/36 to 28/36, while runs in which all three neutral agents give it fall
from 29/36 to 18/36. The restricted version exposes each neutral agent to more
liar-written statements on average, 11.38 rather than 9.24, so the reduction
cannot be attributed to hiding the original false pressure.

The same intervention changes the false-answer count by only 2/144 with two
liar agents and 1/72 with four. This boundary is informative. With two liar
agents, a false answer seldom begins. With four, the direct statements usually
suffice. Statements from newly persuaded agents have their clearest effect in
the intermediate region, where they help complete a cascade that has already
started.

## 4. Whether the question can be checked changes the effect

The main 18-question Haiku evaluation gives the following shared-memory rates
among the two neutral agents: 0.333 on familiar-science questions, 0 on five
GSM8K questions, 0.150 on five GSM-Hard questions, and 0.813 on two SciTaT
questions. Personal memory is zero in all four groups. Live debate is zero
except for 0.063 on the two SciTaT questions.

The larger SciTaT study makes this boundary clearer. The 18 items were selected
because Haiku failed every question-only trial but answered at least 80% of the
full-context trials correctly. On those selected items, shared-memory adoption
is 0.938 across 216 Haiku runs, compared with 0 under personal memory and 0.007
under live debate. The selection does not show that the papers were absent from
pretraining, and the rate is not an estimate for the full SciTaT benchmark.

Together with the zero result on GSM8K, these observations support a narrower
claim: repeated social evidence is most consequential when the model cannot
reliably verify the answer from the question alone. The current experiments do
not identify one universal measure of verifiability.

## 5. Model differences often reflect different individual baselines

On ego depletion, GPT-4o-mini, Llama 3.1 8B, and Ministral 8B 2512 give the false
answer even in personal memory, leaving little room for a shared-memory increase.
Across six questions, shared minus personal memory is 0.160 for GPT-4o-mini,
-0.069 for Llama, and 0.174 for Ministral. The positive differences are
concentrated on the SciTaT questions.

This explains why a single model-by-question result cannot represent the whole
paper. A communication effect is identifiable when the model resists the false
claim without peer statements and changes after reading them. If the individual
baseline is already near one, the shared-memory contrast is at a ceiling; if it
is near zero and the question is readily checked, the result is at a floor.

## 6. One group score can reverse the interpretation

With four liar agents and two other agents, all-agent false endorsement obeys

`FE = (4/6) * liar-agent retention + (2/6) * neutral-agent false endorsement`.

Sonnet and Opus end live debate at all-agent FE 0.467 while the two neutral
agents have a false-answer rate of zero; the nonzero group score comes entirely
from liar agents retaining their instruction. Ministral ends at the similar
all-agent value 0.500 while its neutral-agent false-answer rate is 0.600 and
liar-agent retention is 0.450. The same-looking aggregate therefore describes
opposite outcomes. Reporting the two components is a measurement correction,
not merely an additional metric.

## 7. The answer-free defense has a real effect, with clear limits

In the matched six-question Haiku comparison, showing repetition links without
an explanation changes the neutral-agent false-answer rate from 0.217 to 0.167.
Adding the warning changes it from 0.167 to 0.067. The clean comparison is the
last one because both versions retrieve and link statements in the same way;
only the warning differs.

The effect is not universal. The warning removes false answers on ego depletion
and LK-99 in these runs but leaves PANDAS at 0.400. On ego depletion it reaches
zero for Haiku and Sonnet and 0.200 for GPT-4o-mini. Correct external
verification is stronger, reaching zero in all 25 tested runs across five
models, but it assumes access to the correct answer.

The remaining unanswered question is whether the repetition warning preserves
the helpful correction seen in the honest-mistake experiments. A paired 80-run
test is prepared for that purpose. It compares standard shared memory with the
same repetition-links-with-warning version on the original four distributed-
evidence questions and ten seeds. The accompanying analysis checks recovery of
the initially mistaken agent, accuracy on all three claims, and incorrect
rejection of true claims as a direct test of blanket distrust.

## Paper-level conclusion

The strongest supported story has four linked parts:

1. A shared record can carry useful corrections or persistent false support.
2. Harmful outcomes cluster within runs and often become nearly complete
   cascades.
3. At intermediate pressure, an agent who has changed can help carry the false
   answer to the rest of the group.
4. Evaluation must separate changes by the liar agents from changes by the
   agents whose answers are being measured.

Question and model results define where the effect appears. Repetition links,
warnings, and verification show ways to reduce it. Agent Society provides the
trace and manifest infrastructure needed to make these distinctions auditable.

## Reproducible sources

- `iclr2027/run_manifest.json`
- `iclr2027/neutral_fairness_analysis.json`
- `iclr2027/uncertainty_results.json`
- `analysis/deeper_ratio_analysis.py`
- `analysis/analyze_neutral_peer_isolation.py`
- `analysis/audit_neutral_peer_amplification.py`
- `analysis/results/neutral_peer_amplification_run_manifest.csv`
- `experiments/honest-mistake-defense-preservation-v1.json`
- `analysis/analyze_honest_mistake_defense.py`

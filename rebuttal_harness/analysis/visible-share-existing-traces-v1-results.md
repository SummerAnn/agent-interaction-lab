# Visible-share analysis from existing traces

Descriptive analysis of completed traces. Turn-level rows are correlated within runs, and visible composition is partly affected by earlier neutral responses. These results do not identify a causal mediator.

| Condition | Neutral turns | Mean visible count | Mean endorsement share | Mean source share | Endorsing responses / turns when all visible items endorse | Final E/R/U |
|---|---:|---:|---:|---:|---:|---|
| causal_live_debate_hide_uncertain | 720 | 16.329 | 0.185 | 0.185 | 0/4 | 0/217/23 |
| causal_live_debate_hide_uncertain_last6 | 720 | 5.417 | 0.173 | 0.172 | 0/4 | 1/238/1 |
| causal_live_debate_last6 | 720 | 5.417 | 0.171 | 0.171 | 0/4 | 0/240/0 |
| content_mechanism_live_debate | 720 | 16.500 | 0.187 | 0.183 | 0/4 | 0/212/28 |
| content_mechanism_shared_memory | 720 | 3.250 | 0.999 | 0.808 | 209/656 | 178/1/61 |
| matched_debate | 720 | 16.500 | 0.183 | 0.183 | 0/4 | 0/100/140 |
| matched_shared | 720 | 3.310 | 0.965 | 0.797 | 183/624 | 155/12/73 |
| recording_omit_uncertain | 720 | 3.276 | 1.000 | 0.792 | 225/660 | 185/0/55 |
| recording_save_uncertain | 720 | 5.417 | 0.171 | 0.171 | 0/4 | 0/0/240 |

## Same focal exposure under shared memory and debate

The next table holds fixed the response number, number of visible endorsements, and number of entries written by the two repeating agents. It does not hold the rest of the visible context fixed.

| Response | Visible endorsements | Repeating-agent entries | Shared memory endorses / turns | Shared mean total visible | Debate endorses / turns | Debate mean total visible |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 0/60 | 0.000 | 0/60 | 1.333 |
| 1 | 1 | 1 | 0/122 | 1.205 | 0/120 | 5.500 |
| 1 | 2 | 2 | 0/58 | 2.000 | 0/60 | 9.667 |
| 2 | 2 | 2 | 0/57 | 2.000 | 0/60 | 12.333 |
| 2 | 3 | 3 | 0/115 | 3.000 | 0/120 | 16.500 |
| 2 | 4 | 4 | 11/40 | 4.000 | 0/60 | 20.667 |
| 3 | 4 | 4 | 5/25 | 4.000 | 0/60 | 23.333 |
| 3 | 5 | 5 | 1/34 | 5.000 | 0/120 | 27.500 |
| 3 | 6 | 6 | 5/5 | 6.000 | 0/60 | 31.667 |

On second and third responses with four to six visible endorsements from the repeating agents, shared-memory agents endorse in 22 of 104 turns (21.2%), while debate agents endorse in 0 of 300. Debate shows an average of 26.1 total earlier messages in these rows, compared with 4.4 under shared memory, so this difference cannot be attributed to presentation alone.

When total visible-message count is matched too, overlap exists only for first responses with zero or one visible endorsement. Neither method produces endorsement in those rows. The completed traces therefore do not provide a fully matched high-exposure comparison.

## Interpretation

The shared record makes the visible stream much more endorsement-heavy because uncertain judgments are omitted. This composition is associated with adoption inside shared memory, but it is not a causal explanation by itself. The visible composition is partly produced by the cascade: once neutral agents endorse, their entries increase the endorsement share seen later.

The matched recording-rule comparison supplies the clearest intervention on composition. Saving uncertain entries lowers the visible endorsement share and changes 185 final endorsements to zero, with all 240 neutral agents remaining uncertain. This supports the claim that selective recording contributes to adoption in this Haiku setting.

The debate ablations are a narrower check. Hiding uncertain debate messages, limiting debate to six recent messages, or making both changes produces 0, 0, and 1 final false endorsement, compared with 178 under shared memory in the same 24 orders. These debate arms use the discussion instructions, which lead agents to reject at the start, and their visible streams remain dominated by rejections. They therefore rule out those two interface changes under the tested prompt but do not provide a causal mediation test under an uncertain starting point.

At the same focal exposure of four to six visible repeating-agent endorsements, shared-memory agents sometimes endorse and debate agents do not. The rest of the context is not the same: debate also shows many more messages, including rejections and uncertainty. This comparison therefore narrows the explanation but does not show that presentation alone causes the memory–debate gap.

Together, the existing data show that selective visibility contributes to the result but do not establish that endorsement share or source share fully explains the memory–debate gap. Source share is also not a monotone predictor: as neutral agents become persuaded, they add endorsements of their own and the fraction written by the two original sources falls.

Order-level correlations are included in the JSON output for audit, not as independent-sample estimates or causal mediation effects.

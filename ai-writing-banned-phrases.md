# Banned AI Phrases and Patterns

User explicitly requested: avoid all AI-isms in writing. This applies to paper text, commit messages, PR descriptions, and any prose output.

Sources: Reddit r/WritingWithAI megathread, AI Writers Room blog, Grammarly AI detection guide, Pangram comprehensive guide, Wikipedia:Signs of AI writing, The Atlantic ("The Biggest Tell"), AI-isms of Writing Bible (JSON v1.0).

## Contrastive Negation ("not X, it's Y")
The single biggest AI tell. Never use:
- "It's not X, it's Y"
- "not just X, it's Y"
- "not merely X"
- "not simply X"
- "not only X but also Y"
- "This is not an argument against X. It is an argument for Y."
- "The goal is not to X but to Y"
- "it's not about X, it's about Y"
- Any em-dash variant: "X isn't just evolving -- it's accelerating"

Fix: make a direct affirmative statement instead of negating then reframing.

## Punctuation Rules
- Em dashes: one or two per page maximum. Never combine with contrastive negation. 90% of the time a comma works. AI uses em dashes instead of commas, parentheticals, or semicolons where no human would.
- Colons: avoid using colons to introduce dramatic reveals or set up "here's the answer" moments. Colons before lists are fine. Colons as rhetorical devices ("And here's why:") are banned. "The result?" "The kicker?" "Why it matters:" all banned.
- Semicolons: avoid in output. AI overuses semicolons for balanced compound sentences ("X is good; however, Y is bad"). Use periods or restructure.
- Do not stack colons and semicolons just to sound organized. If a period works, use the period.
- Hyphens: AI over-hyphenates words and phrases most humans would leave unhyphenated. Consistent, correct hyphenation is itself a tell.
- Commas after sentence-starting words: AI adds formal commas after opening words ("Also, LLMs will...") where casual writing skips them. Only use in formal contexts.
- Ellipses: AI overuses ellipses for false drama ("And then... silence...", "She waited... and waited..."). Only use for genuine trailing off or interrupted speech.
- Bold/italics: excessive emphasis is a tell ("This isn't just *important* — it's **revolutionary**"). Limit to one per 500 words. Rely on word choice instead.
- General: prefer commas and periods. Fancy punctuation draws attention.

## Transitional Filler
Banned: Moreover, Furthermore, Indeed, Additionally, Notably, More broadly, In summary, Ultimately, It is worth noting that, In the context of, When it comes to, As we delve into, Let's dive in, Let's break it down, Let's dissect this, That being said, At its core, From a broader perspective, A key takeaway is, It's important to note, Overall, While X is true we must also consider Y (balanced-take filler), As mentioned earlier, To reiterate, Building upon this, In addition, Subsequently, Conversely, That made the next step clear, That result matters because, That changed the way I think about, That is the version of the story I would stand behind right now

## Summary and Echo Closers
- Conclusion cliches: "In conclusion," "Ultimately," "At the end of the day," "In essence."
- The final-sentence bow: "It is not only about [Topic A], but also about [Topic B]." This is already covered by the contrast-frame rule, but it is especially suspicious as a closer.
- Forced call-to-action endings: "embrace the future," "navigate the complexities," and similar upbeat wrap-ups that refuse to end on the actual result.
- Endings that restate the opening in cleaner, flatter language instead of adding evidence or tension.

## Grandiose/Vague Descriptors
Banned: tapestry, landscape, realm, paradigm, ecosystem, symphony, nexus, journey, delve, unravel, harness, leverage, embark, crucial, pivotal, transformative, intricate, myriad, profound, meticulous, nuance (as filler), revolutionize, innovative (as filler), cutting-edge, game-changing, seamless, scalable, elevate, empower, unlock, foster, groundbreaking, bustling, enigmatic, vibrant, robust, dynamic, compelling, invaluable, commendable, noteworthy, multifaceted, comprehensive (as filler), unwavering, relentless, timeless, unyielding, nestled, enduring, garner, important, matters, focal claim, the picture, deliberate poisoning, rescue the system, ugliest failures, doing real work

## Formal Synonyms (use the plain word)
- utilize -> use
- facilitate -> help
- endeavor -> try
- commence -> start
- elucidate -> explain
- underscore -> highlight or emphasize
- illuminate -> explain
- bolster -> support
- streamline -> simplify
- differentiate -> distinguish
- refine -> improve (when used generically)
- shed light on -> explain or clarify
- navigate -> handle, deal with
- showcase -> show
- interplay -> interaction
- serves as / stands as / marks / represents -> is (AI avoids "is"/"are" copulatives)
- boasts -> has
- features / offers -> has
- aligns with -> matches, fits

## Structural Patterns
- Rhetorical question followed by immediate answer ("What does this mean? It means...")
- Short sentences. For emphasis. Always three. (rule of three for drama, AI abuses it)
- "prophetic narrator" transitions ("And then, everything changed.")
- Interpretive commentary (describing an action then explaining what it means, e.g. "she crossed her arms, a gesture more defensive than welcoming")
- Ending every section with a character/narrator reflecting on the meaning
- Hedging: "It can be argued that", "One might say", "Generally speaking", "Broadly speaking", "To some extent"
- Leading with the "big idea" in the most plain-spoken way, then restating it (AI always front-loads the lede)
- Forced sass / hot-take framing: "But here's the thing:", "Then I realized:", "The result?", "Hot take:"
- "No [X]. No [Y]. Just [Z]." pattern
- "From X to Y:" title structure
- Overly neat intro + conclusion structure; conclusion repeats intro
- Bullet point lists appearing suddenly in flowing prose
- Every paragraph roughly the same length
- Trailing "-ing" superficial analyses: "...highlighting its importance", "...underscoring the significance", "...emphasizing the need for" (Wikipedia calls these the biggest structural tell)
- "Despite its [positive], X faces challenges..." followed by vague optimism
- "Challenges and Future Outlook" sections
- Dramatic fragments for false emphasis: "She waited. And waited. Nothing happened." or "It was over. Finally. Completely."
- Preamble syndrome: "Let's break it down", "Let's dive into this", "Let's dissect this topic" — start directly with content
- Section headers breaking narrative into labeled parts ("### Understanding the Problem", "### The Solution", "### Moving Forward")
- Redundant adjective pairs: "dark and brooding", "loud and brash", "quick and agile" — pick one strong word
- Unmotivated/forced metaphors: random comparisons that don't clarify meaning ("like sandpaper on silk")
- Feelings that "smell like" or "sound like" something; weather described with "the kind that..."
- Lack of intent: starting a sentence without knowing its purpose, ending up with filler that sounds complete but says nothing
- "That is not what I found."
- "I pushed one step further"
- "I started with a pretty basic question"
- "The issue was not X. The issue was Y."
- "Not A, but B" contrast frames even without the exact old template
- slogan lines that sound conclusive but do not add evidence

## Distinctive Syntactic Patterns
- Noun + noun pairings used as prestige filler: "fostering collaboration," "driving innovation," "shaping narratives."
- Elevator-pitch passive voice: "It can be argued that..." or "Careful consideration must be given to..." when a direct subject would be clearer.
- Symmetrical sentence balancing that makes every contrast sound prewritten: "While technology empowers connection, it simultaneously isolates individuals."
- Clause pairs that feel perfectly weighted on both sides instead of sounding like someone actually pushing a claim.

## Copula Avoidance (Wikipedia-documented)
AI avoids simple "is"/"are" and replaces them with fancier verbs:
- "serves as" instead of "is"
- "stands as" instead of "is"
- "represents" instead of "is"
- "marks" instead of "is"
- "boasts" instead of "has"
- "features" instead of "has"
A 10%+ drop in "is"/"are" usage was measured in academic writing post-2023.
Fix: just use "is", "are", "has" when that's what you mean.

## Academic-Specific AI Tells
- "In today's rapidly evolving..."
- "In the dynamic landscape of..."
- "As the world continues to evolve..."
- "A testament to"
- "Unlock the potential of"
- "On one hand... on the other hand" (overuse)
- Passive voice dominance: "It has been observed that"
- Starting sentences with gerund phrases: "Navigating the complexities of..."
- "This underscores the importance of..."
- "Looming challenges"
- "Paving the way for"
- "Serves as a reminder"
- "Is a testament to"
- "Stark reminder"
- "Setting the stage for"
- "Reflects broader trends"
- "A key turning point"
- "Indelible mark"

## Fiction-Specific Tells
- Concluding reflections: ending every scene/chapter with the character reflecting on life ("As he looked out at the cold night, he wondered what the future held", "Life, X reflected, is...")
- Dialogue tag overuse: AI uses "whispered", "yelled", "sighed", "murmured" etc. 70-80% of the time. Human writers use "said"/"asked" 60-70%. Overuse of non-said tags is a tell.
- Body reaction clichés: "jaw tightens", "stomach dropped", "breath hitched", "something shifted", "eyes widened"
- Romance clichés: "pressed his forehead against hers", "lips swollen with kisses", "blooming like a promise", "leaned forward, resting elbows on the counter"
- Repetition of a single irrelevant detail throughout a story, mechanically rather than emotionally
- "Restricted. Intentional. Silent." — adjective-only fragments stacked for atmosphere
- AI doesn't foreshadow well; it either telegraphs ("And then, everything changed") or misses it entirely

## Cadence / Rhythm
- AI prose has a weird poem-like cadence (Victorian-era rhythm)
- Overly balanced sentence structures (compound sentences with semicolons or "however/therefore/thus")
- Every paragraph same length, same structure
- Monotonous sentence length; human writing varies more
- Elegant variation: AI avoids repeating words (has a repetition-penalty), swaps in fancy synonyms instead. Human writers repeat words when appropriate.
- Fix: vary sentence length, break rhythm deliberately. Repeat a word if it's the right word.

## Tone Tells
- Overly positive, avoids criticizing viewpoints
- Earnest helpfulness ("I hope this helps", pointing out it's being helpful)
- Overly formal unless told otherwise
- Vague and general to avoid being wrong (hedges everything)
- No personal experience, no specific proper nouns
- "AI names": Emily, Sarah, etc. appear 60-70% of the time in fiction
- "Simultaneously breezy and grandiose" (The Atlantic) -- a distinctive AI voice that sounds casual and important at the same time
- Suspiciously clean: no stray commas, no rough edges, uniform paragraph length
- The overall *perfection* is itself a tell; human writing has texture and imperfection
- Vague attributions: "Experts argue", "Observers have cited", "Industry reports suggest" (weasel words)
- Puffery/promotional tone even for mundane subjects
- "A small point, but..." and "The path is clear..." — formulaic hedging/concluding phrases
- neat slogan sentences that try to sound wise instead of sounding observed
- vague evaluative claims with no numbers ("often helped", "did not", "worked better") when the numbers are available

## Psychological and Tone Tell-Tales
- Aggressive neutrality: "On one hand... on the other hand," "the truth likely lies somewhere in the middle," and other fake-balance lines that refuse to land anywhere.
- Toxic positivity: helpful, enthusiastic, universally encouraging language even when the material is grim, messy, or weak.
- Unearned profundity: making ordinary points sound cosmic with words like "tapestry," "symphony," "nexus," or "landscape."
- Inspirational uplift tacked onto weak evidence so the piece can end on a confident note.

## Live Thread Additions
These came directly from live review and should be treated as banned patterns in normal writing.

- Avoid using `clear` as a closing judgment unless you say what became clear.
- Avoid `important` and `matters` as stand-alone evaluation words.
- Avoid `focal claim`, `the picture`, and similar abstract labels when a plain noun works.
- Avoid buzzy attack labels like `deliberate poisoning` unless the method section has already defined them precisely.
- Avoid neat moral-of-the-story endings. End on the result, limitation, or next question instead.
- Avoid fake-human scene setters in technical prose.

## Surging AI Words (from University of Helsinki study on student essays post-ChatGPT)
These words saw statistically significant increases in usage after ChatGPT launched:
delve, crucial, significant, comprehensive, multifaceted, commendable, meticulous, intricate, notable, noteworthy, invaluable, pivotal, realm, foster, facilitate, utilize, underscore, landscape, testament, nuanced

## What To Do Instead
- Direct affirmative statements
- Vary sentence length naturally
- Use plain words ("is" instead of "serves as", "has" instead of "boasts")
- Let the data speak; skip the framing fluff
- If a sentence works without a transition word, cut the transition word
- Be specific instead of grandiose ("improved accuracy by 12%" beats "revolutionized accuracy")
- Include concrete details instead of adjective-heavy filler
- When you want contrast, restructure the whole sentence instead of "not X, it's Y"
- Use contractions occasionally (human writers do)
- It's fine to start a sentence with "And" or "But" (AI avoids this)
- Imperfect grammar is sometimes more human than "perfect" grammar
- Repeat a word if it's the right word; don't swap in a fancy synonym just for variety
- Use "is" and "are" freely; don't avoid them
- If the claim came from your own work, say `I think`, `I realized`, `I believe`, or `I observed` when that is the truth.
- If you have numbers, use the numbers and then say what they mean in plain words.
- Prefer simple words over researchy labels. `false claim` beats `focal claim`. `main result` beats `key takeaway`.
- If two conditions differ, name both conditions and show the difference instead of saying one `helped` or `mattered`.
- End where the evidence ends. Do not force a moral, a summary slogan, or a call to action.
- Use active voice when you know who did the thing.
- If the evidence points one way, say so. Do not add fake balance for politeness.
- Prefer concrete verbs over abstract noun pairings.
- Keep routine ideas routine. Not every sentence needs to sound profound.

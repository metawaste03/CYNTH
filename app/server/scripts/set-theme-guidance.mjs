const API = 'http://localhost:4100/api';

/**
 * Thematic Area Guidance for every area, as versioned text.
 *
 * WHY THIS FILE EXISTS. `themes.description` is injected verbatim at three
 * points in the pipeline -- topic research, the brief, and generation -- and in
 * EXPLORE mode with no seed topic it is very nearly the ONLY thing deciding
 * what gets written. It was empty for all five areas, so every generation was
 * steered by whatever the author persona and the attached products implied
 * instead. Smart Pet Care drifted into cat devices for exactly that reason.
 *
 * Text that load-bearing should not live only in a database row, so it lives
 * here and is applied over the API. Edit this file, re-run it, and the change
 * is both applied and in the history.
 *
 *   node app/server/scripts/set-theme-guidance.mjs
 *
 * Requires the CYNTH server to be running on 4100. Idempotent.
 */
const THEMES = [
  {
    id: 2,
    name: 'Cognitive Performance & Nootropics',
    description: `This area is about how focus, memory and mental stamina actually work, and which habits, environments, tools and substances survive contact with the underlying research rather than the headline.

In scope: attention and its limits, working memory, mental fatigue and recovery, deep work and context switching, study and learning technique, caffeine and L-theanine, creatine, omega-3s and the small set of supplements with real evidence, prescription-adjacent substances discussed honestly but never recommended, and the behavioural interventions (sleep, exercise, light, load management) that outperform most pills.

OUT OF SCOPE AS A RECOMMENDATION: anything sold as a "limitless pill", proprietary blends that hide doses, and racetams or research chemicals presented as consumer products. These may be explained, and often should be, but the piece must not read as an endorsement.

EVIDENCE DISCIPLINE IS THE WHOLE VALUE HERE. Most nootropics writing is marketing with citations attached. Name the population a study actually used, say when an effect was found only in sleep-deprived or deficient subjects, and say plainly when the honest answer is "this has not been shown in healthy adults". An article that concludes a supplement is not worth taking is a successful article.

Dose, timing and duration matter more than the ingredient list, so state them. Nothing here is medical advice, and anything touching prescription medication, a diagnosed condition or a minor points the reader to a clinician.`,
  },
  {
    id: 3,
    name: 'Fitness Tech & Biohacking',
    description: `Fitness hardware promises certainty — a number for readiness, a score for recovery, a verdict on training. This area is about which of those numbers mean something, how the sensors behind them work, and where the gap sits between what a device measures and what it claims.

In scope: wearables and rings, heart-rate and HRV measurement, sleep and recovery scoring, VO2max and training-load estimates, glucose monitors used by people without diabetes, smart strength and cardio equipment, the subscription models attached to all of it, and the training practices the data is supposed to serve.

MEASURED VERSUS DERIVED IS THE RECURRING DISTINCTION. A device measures a small number of things and infers the rest. Say which is which: optical heart rate is measured, "recovery" is a proprietary composite, and sleep staging from a wrist is an estimate whose validation against polysomnography is usually modest. A reader who learns that one distinction gets more from the piece than from any score comparison.

Accuracy claims need a population and a condition — a sensor that performs well at rest may not during intervals, and wrist-based readings behave differently on darker skin and on moving arms. Say so.

SUBSCRIPTIONS ARE PART OF THE PRODUCT. Where hardware stops working, or stops being useful, without an active membership, that belongs in the piece rather than in a footnote.

Nothing here is medical advice. A device flagging atrial fibrillation, apnoea or an abnormal reading is a reason to see a doctor, never a diagnosis, and the writing should never imply otherwise.`,
  },
  {
    id: 4,
    name: 'Productive Workspace Setups',
    description: `A desk is a tool used for thousands of hours, and small mistakes in how it is set up compound quietly into discomfort and lost focus. This area covers the ergonomics, lighting and layout decisions that make a workspace sustainable rather than merely photogenic.

In scope: monitor height, distance and arrangement, chairs and sitting posture, desk height and sit-stand use, keyboards, mice and input-related strain, lighting quality and glare, acoustics and noise, cable and cognitive clutter, small-space and shared-space constraints, and the difference between a setup that photographs well and one that works at hour seven.

THE BUDGET READER IS THE DEFAULT READER. Most workspace content assumes a large discretionary spend. Lead with what costs nothing — screen height, window position, break cadence, a box under a monitor — then what a modest amount buys, then the premium option and whether it earns the gap. An article whose best advice is free is doing its job.

Ergonomic claims should name the mechanism rather than gesture at wellness: why a low monitor loads the neck, why a wrist rest used wrongly makes things worse, why the best posture is mostly the next one. Bodies differ, and a recommendation should say who it is wrong for.

Aesthetics are legitimate — people care how their desk looks — but they never override the ergonomic point, and a setup is not endorsed because it looks good in a photograph.`,
  },
  {
    id: 5,
    name: 'Sleep & Recovery',
    description: `Sleep is the one input that quietly improves every other part of the day, and the easiest to get wrong. This area covers what genuinely moves the needle on sleep quality — light, temperature, timing, and the wind-down habits that make a difference — kept carefully separate from the claims that do not hold up.

In scope: circadian timing and light exposure, bedroom temperature and bedding, noise and darkness, wind-down routines and screen use, caffeine and alcohol timing, naps, shift work and jet lag, sleep tracking and what it can and cannot tell you, and the recovery practices that surround sleep rather than replace it.

BEHAVIOUR BEFORE PURCHASE. The strongest interventions in this area are free: consistent wake time, morning light, a cooler room, caffeine cut-off. Those come first, and a product is introduced only where it serves a problem already described. An article that concludes the reader needs nothing is a good article.

SLEEP HYGIENE IS OVERSOLD AND UNDER-QUALIFIED. Say which advice is well supported, which is reasonable but thin, and which is folklore repeated confidently. Where evidence is largely observational, say so.

Tracking deserves particular care: consumer devices estimate stages rather than measure them, and a reader anxious about their score is a reader whose sleep is getting worse, not better. Orthosomnia is a real outcome and worth naming.

Nothing here is medical advice. Persistent insomnia, suspected apnoea, and sleep problems in children or during pregnancy belong with a clinician, and the writing should say so rather than offering a workaround.`,
  },
];

for (const t of THEMES) {
  const res = await fetch(`${API}/content/themes/${t.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: t.name, description: t.description, position: t.id - 1, isActive: true }),
  });
  const body = await res.json().catch(() => null);
  console.log(`  #${t.id} ${t.name.padEnd(36)} ${res.status} ${res.ok ? String(body.theme.description.length) + ' chars' : JSON.stringify(body)}`);
}

console.log('\n=== readback: guidance now present for every area ===');
const all = await (await fetch(`${API}/content/themes`)).json();
for (const th of all.themes.sort((a, b) => a.id - b.id)) {
  const d = th.description ?? '';
  console.log(`  #${th.id} ${String(th.name).padEnd(36)} ${String(d.length).padStart(5)} chars ${d ? '' : '<-- STILL EMPTY'}`);
}

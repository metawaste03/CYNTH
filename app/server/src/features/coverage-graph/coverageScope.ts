/**
 * WHAT EACH AREA IS FOR, AS SOMETHING THAT CAN BE COUNTED.
 *
 * Every area's brief already lists what is "in scope" — as prose, which
 * topic research reads and nothing can check. This is the same list as data:
 * one core idea per area, the subtopics the brief names, and a ring of
 * adjacent subtopics that widen the area without leaving it.
 *
 * WHY THE RING IS WRITTEN DOWN. "Expand the scope without straying too far"
 * needs a boundary someone has actually drawn. Each adjacent subtopic here
 * is in the ring because it is answered by the area's core idea — smart
 * scales belong to Fitness Technology because "measured versus derived" is
 * exactly the question a body-fat percentage raises. A subtopic that cannot
 * say which core idea it serves is not in the ring, and topic research may
 * only PROPOSE one like that; a person approves it before anything is written.
 *
 * Kept beside the code, like the facets in areaBalance.service.ts, so a
 * reading of a brief does not drift away from the brief in a settings screen.
 * Matched to themes by name. The database copy (coverage_subtopics) is seeded
 * from here and is where proposals and decisions are recorded.
 */

export interface ScopeSubtopic {
  name: string;
  /** What the subtopic covers, in the words that get embedded and compared. */
  description: string;
}

export interface AreaScope {
  coreIdea: string;
  core: ScopeSubtopic[];
  adjacent: ScopeSubtopic[];
}

const s = (name: string, description: string): ScopeSubtopic => ({ name, description });

export const AREA_SCOPES: Record<string, AreaScope> = {
  'Smart Pet Care': {
    coreIdea:
      'The smarter decision about a dog or cat\'s wellbeing — dogs and cats both — where a change to routine is as valid an answer as a product, and anything clinical goes to the vet.',
    core: [
      s('Weight and body condition', 'Healthy weight, body condition scoring, weight loss plans for overweight dogs and cats.'),
      s('Dental care', 'Brushing, dental chews, water additives, dental diets and dental disease in dogs and cats.'),
      s('Joints, mobility and ageing', 'Arthritis, mobility, joint supplements and caring for an ageing dog or cat.'),
      s('Skin, coat and grooming', 'Shedding, brushing, bathing, itchy skin, coat condition and grooming routines.'),
      s('Parasite prevention', 'Fleas, ticks, worms and choosing parasite prevention for dogs and cats.'),
      s('When to see a vet', 'Recognising symptoms that warrant a vet visit rather than waiting.'),
      s('Reading pet food labels', 'What complete and balanced means, guaranteed analysis, ingredient lists and pet food marketing claims.'),
      s('Portioning and calorie arithmetic', 'How much to feed, calorie needs, portion sizes in grams and cups.'),
      s('Treats and snacks', 'Choosing treats, treat calories and treats that undo a diet.'),
      s('Unsafe foods', 'Foods that are toxic or unsafe for dogs and cats.'),
      s('Boredom and enrichment', 'Enrichment, puzzle feeders, play and preventing boredom.'),
      s('Separation and being left alone', 'Separation anxiety, leaving a pet alone, signs of distress.'),
      s('Training fundamentals', 'Reward-based training basics, recall, house training, common training mistakes.'),
      s('Feeding schedules and routine', 'Meal frequency, feeding times and daily routine.'),
      s('Exercise needs', 'How much exercise dogs and cats need by age, breed and health.'),
      s('Litter and toileting', 'Litter boxes, litter types, toileting problems and house soiling.'),
      s('Multi-pet households', 'Introducing pets, managing several dogs or cats, resource guarding between pets.'),
      s('Travel and vet visits', 'Car travel, carriers, reducing stress at the vet, boarding and pet sitters.'),
      s('Connected pet products', 'What pet cameras, smart feeders, GPS trackers and automatic litter boxes can tell an owner, subscriptions, and when lower-tech is better.'),
    ],
    adjacent: [
      s('Hydration and water intake', 'How much water dogs and cats should drink, fountains, wet food and hydration.'),
      s('Puppy and kitten first months', 'Feeding, vaccination schedule, socialisation and routine for a new puppy or kitten.'),
      s('Home safety and pet-proofing', 'Household hazards, plants, cables and making a home safe for a dog or cat.'),
      s('Seasonal care', 'Heatstroke, cold weather, fireworks and seasonal risks for dogs and cats.'),
      s('Vet cost planning', 'Budgeting for vet care, pet insurance basics and preventive care costs.'),
      s('Breed-linked health risks', 'Health problems linked to particular dog and cat breeds and what owners can do.'),
    ],
  },

  'Cognitive Performance': {
    coreIdea:
      'How focus, memory and mental stamina actually work, judged on evidence in healthy adults — dose, timing and population stated, and "not shown" said plainly.',
    core: [
      s('Attention and its limits', 'How attention works, sustained attention, vigilance and why focus fades.'),
      s('Working memory', 'Working memory capacity, cognitive load and whether it can be trained.'),
      s('Mental fatigue and recovery', 'Mental fatigue, the afternoon dip, recovery breaks and mental stamina.'),
      s('Deep work and context switching', 'Context switching costs, attention residue, task batching and focus blocks.'),
      s('Study and learning technique', 'Spaced repetition, retrieval practice, interleaving and evidence-based study methods.'),
      s('Caffeine and L-theanine', 'Caffeine dose and timing for focus, L-theanine pairing and tolerance.'),
      s('Creatine for cognition', 'Creatine dose, brain saturation and cognitive effects.'),
      s('Omega-3s', 'Omega-3, DHA and EPA for focus and memory.'),
      s('Supplements with real evidence', 'The small set of cognitive supplements with human evidence, and what they do not do.'),
      s('Reading supplement labels', 'Proprietary blends, doses on labels and spotting marketing on a nootropic label.'),
      s('Prescription-adjacent substances', 'Modafinil, stimulants and racetams explained honestly, never recommended.'),
      s('Sleep for cognition', 'How sleep loss affects attention and memory.'),
      s('Exercise for cognition', 'Acute and long-term effects of exercise on focus and memory.'),
      s('Light and alertness', 'Bright light, daylight and alertness during the day.'),
    ],
    adjacent: [
      s('Meal timing and energy dips', 'Meals, blood sugar and post-lunch dips in alertness.'),
      s('Hydration and cognition', 'Mild dehydration and its effect on focus.'),
      s('Stress and performance', 'Acute stress, anxiety and their effects on thinking and memory.'),
      s('Notifications and digital distraction', 'Phone notifications, multitasking with devices and focus.'),
      s('Music and noise for focus', 'Background music, noise and white noise while working or studying.'),
      s('Meditation and attention training', 'Mindfulness and attention-training practices and their evidence.'),
      s('Cognitive ageing', 'Keeping memory and attention sharp with age.'),
    ],
  },

  'Fitness Technology': {
    coreIdea:
      'Which device numbers mean something: what a sensor measures versus what it derives, how accurate it is for whom and when, and what the subscription takes away.',
    core: [
      s('Wearables and rings', 'Fitness watches, bands and smart rings compared on what they measure.'),
      s('Heart rate accuracy', 'Optical wrist heart rate versus chest straps, accuracy during exercise.'),
      s('HRV measurement', 'Heart rate variability, RMSSD, overnight versus morning readings and how to use HRV.'),
      s('Sleep and recovery scores', 'Readiness, recovery and sleep scores as proprietary composites.'),
      s('VO2max estimates', 'How wearables estimate VO2max and how accurate it is.'),
      s('Training load estimates', 'Training load, strain, acute to chronic load and training status features.'),
      s('Calorie estimates', 'Wearable calorie burn accuracy and setting calorie targets.'),
      s('CGMs without diabetes', 'Continuous glucose monitors used by people without diabetes.'),
      s('Smart strength equipment', 'Digital weight machines and connected strength equipment.'),
      s('Smart cardio equipment', 'Connected bikes, treadmills and rowers.'),
      s('Subscriptions and lock-in', 'What fitness hardware does without a membership and data lock-in.'),
      s('Training practices the data serves', 'Zone 2, intervals, progressive overload and how data should inform training.'),
    ],
    adjacent: [
      s('Smart scales and body composition', 'Bioimpedance body fat, muscle mass estimates and smart scale accuracy.'),
      s('Blood pressure monitors', 'Home and wearable blood pressure measurement accuracy.'),
      s('GPS and running power', 'GPS distance accuracy, pace and running power metrics.'),
      s('Pulse oximetry and SpO2', 'Blood oxygen readings from wearables and what they mean.'),
      s('Skin temperature and cycle tracking', 'Temperature sensing and menstrual cycle features on wearables.'),
      s('Step counts and activity goals', 'Step count accuracy and whether step targets matter.'),
      s('Fitness data export and privacy', 'Exporting, owning and protecting fitness data.'),
    ],
  },

  'Productive Workspaces': {
    coreIdea:
      'A workspace that still works at hour seven: ergonomics, lighting and layout explained by mechanism, free fixes first, then modest spend, then premium.',
    core: [
      s('Monitor height, distance and arrangement', 'Monitor position, eye level, viewing distance and multi-monitor layout.'),
      s('Chairs and sitting posture', 'Choosing and adjusting an office chair, seat depth, lumbar support, armrests.'),
      s('Desk height', 'Correct desk height, desks that are too high or too low.'),
      s('Sit-stand use', 'Standing desks, how long to stand and alternating positions.'),
      s('Keyboards', 'Keyboard height, split and low-profile keyboards and typing strain.'),
      s('Mice and pointing devices', 'Vertical mice, trackballs, mouse position and reach.'),
      s('Wrist and input strain', 'Wrist pain, wrist rests and input-related strain.'),
      s('Lighting and glare', 'Desk lamps, glare, screen brightness and eye strain.'),
      s('Acoustics and noise', 'Noise at home and in offices, sound absorption, headphones for focus.'),
      s('Cable and visual clutter', 'Cable management, desk clutter and cognitive clutter.'),
      s('Small spaces', 'Workspaces in small rooms, corners and fold-away setups.'),
      s('Shared spaces', 'Working in shared rooms and with other people at home.'),
      s('Laptop setups', 'Making a laptop workspace ergonomic.'),
      s('Budget upgrade priorities', 'What to upgrade first on a limited budget.'),
      s('Breaks and movement', 'Break cadence, micro-breaks and moving during the workday.'),
    ],
    adjacent: [
      s('Video-call setup', 'Camera position, lighting and microphone for video calls.'),
      s('Temperature and air quality', 'Room temperature, ventilation and CO2 at the desk.'),
      s('Footrests and standing mats', 'Footrests, anti-fatigue mats and lower-body support.'),
      s('Setups for tall and short people', 'Adjusting desks, chairs and monitors for bodies outside the average.'),
      s('Screen settings for eye comfort', 'Text size, contrast, dark mode and refresh rate for eye comfort.'),
      s('Portable work kits', 'Working from cafés, travel and hybrid setups with portable gear.'),
    ],
  },

  'Sleep & Recovery': {
    coreIdea:
      'What genuinely moves sleep quality — behaviour before purchase, with the evidence graded and anything clinical sent to a clinician.',
    core: [
      s('Circadian timing and light', 'Morning light, body clock timing and light exposure through the day.'),
      s('Consistent wake time', 'Regular sleep schedule, wake time and social jet lag.'),
      s('Bedroom temperature and bedding', 'Room temperature for sleep, cooling bedding and overheating at night.'),
      s('Noise and darkness', 'Blackout, eye masks, earplugs, white noise and a quieter bedroom.'),
      s('Wind-down routines', 'Pre-sleep routines and relaxing before bed.'),
      s('Screens before bed', 'Phones, blue light and screen use before sleep.'),
      s('Caffeine timing', 'Caffeine cut-off times and caffeine\'s effect on sleep.'),
      s('Alcohol and sleep', 'Alcohol, REM rebound and night-time waking.'),
      s('Naps', 'Nap length, timing and whether naps help or hurt night sleep.'),
      s('Shift work', 'Sleeping on shift work and night shifts.'),
      s('Jet lag', 'Shifting the body clock for travel across time zones.'),
      s('Sleep tracking', 'What sleep trackers measure, accuracy and orthosomnia.'),
      s('Recovery practices', 'Recovery practices around sleep: rest days, relaxation and recovery habits.'),
    ],
    adjacent: [
      s('Melatonin and sleep supplements', 'Melatonin dose and timing, magnesium and other sleep supplements and their evidence.'),
      s('Mattresses and pillows', 'Choosing a mattress or pillow and what matters for sleep.'),
      s('Exercise timing and sleep', 'Whether evening exercise disrupts sleep.'),
      s('Food and meal timing before bed', 'Late meals, hunger and food affecting sleep.'),
      s('Sharing a bed', 'Partners, snoring, different schedules and pets in the bed.'),
      s('Stress and racing thoughts at night', 'Rumination, worry and lying awake.'),
      s('When it is more than sleep hygiene', 'Signs of insomnia or apnoea that need a clinician, and what CBT-I is.'),
    ],
  },
};

export function scopeFor(themeName: string | null | undefined): AreaScope | null {
  return themeName ? AREA_SCOPES[themeName] ?? null : null;
}

/** What gets embedded for a subtopic: its name gives the description its subject. */
export function subtopicInput(subtopic: { name: string; description: string }): string {
  return `${subtopic.name}: ${subtopic.description}`;
}

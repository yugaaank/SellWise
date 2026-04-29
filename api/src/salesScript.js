'use strict'

const STAGES = {
  GREETING: 'greeting',
  DISCOVERY: 'discovery',
  PITCH: 'pitch',
  OBJECTION: 'objection',
  CLOSE: 'close',
  POST_CLOSE: 'post_close',
}

const STAGE_INSTRUCTIONS = {
  greeting: `
CURRENT STAGE: GREETING
- Start with a warm, confident introduction as CreditQ's senior sales advisor
- Immediately explain what CreditQ does in ONE punchy sentence
- Mention the core pain point: MSMEs lose crores to bad debts
- Ask ONE qualifying question to open discovery
- Maximum 4 sentences — this is a voice call
`,
  discovery: `
CURRENT STAGE: DISCOVERY
- Uncover pain — ask ONE pointed question about their credit situation
- Listen for: number of buyers, past defaults, recovery challenges, verification gaps
- When a pain point surfaces, acknowledge it then prepare to pitch
- Mirror their language — if they say "customers delay", use "delay" not "default"
- Maximum 3 sentences
`,
  pitch: `
CURRENT STAGE: PITCH
- You have their pain point — now match it to the RIGHT plan
- Lead with the problem they named, then present the solution
- Name a specific plan with 2-3 concrete benefits
- Use ROI framing: one bad debt recovery pays for this plan multiple times over
- End with a soft trial close: "Does this sound like what you need?"
`,
  objection: `
CURRENT STAGE: HANDLING OBJECTION
- You have hit resistance — do NOT back down, reframe
- Acknowledge their concern in ONE word: "Fair", "Understood", "Valid"
- Pivot immediately: "Here is the thing though —"
- Use a concrete counter: cost vs bad debt loss, or offer free BASIC as foot-in-door
- End with a question to re-engage: "Does that make sense?"
`,
  close: `
CURRENT STAGE: CLOSING
- They are ready — do not over-explain, move to action
- Use assumptive close: "Let us get your account set up — what is your GST number?"
- If hesitant, add urgency: "This pricing is promotional — this week only"
- If still stalling, offer BASIC free tier as entry point: "Start free, upgrade when ready"
- ONE clear call to action per response
`,
  post_close: `
CURRENT STAGE: POST-CLOSE / FOLLOW-UP
- They have committed or agreed to call back — wrap up warmly
- Confirm next steps clearly in 1-2 sentences
- Leave them with ONE memorable reason to trust CreditQ
- Thank them genuinely — you just protected their business
`,
}

const OBJECTION_SIGNALS = ['expensive', 'costly', 'think about', 'not sure', 'discuss', 'partner', 'later', 'competitor', 'already have', 'not needed', 'no need', 'too much']
const CLOSE_SIGNALS = ['interested', 'sounds good', 'tell me more', 'how do i', 'sign up', 'register', 'gst', 'proceed', 'want to', 'let us', "let's"]

const STAGE_PROGRESSION = {
  [STAGES.GREETING]: { minTurns: 1, next: STAGES.DISCOVERY },
  [STAGES.DISCOVERY]: { minTurns: 3, next: STAGES.PITCH },
  [STAGES.PITCH]: { minTurns: 5, next: STAGES.CLOSE },
  [STAGES.OBJECTION]: { minTurns: 0, next: STAGES.PITCH },
  [STAGES.CLOSE]: { minTurns: 0, next: STAGES.POST_CLOSE },
  [STAGES.POST_CLOSE]: { minTurns: 0, next: STAGES.POST_CLOSE },
}

function getInitialStage() {
  return STAGES.GREETING
}

const STAGES_PAST_CLOSE = new Set([STAGES.CLOSE, STAGES.POST_CLOSE])

function advanceStage(currentStage, turnCount, lastUserMessage) {
  const msg = (lastUserMessage || '').toLowerCase()

  if (!STAGES_PAST_CLOSE.has(currentStage) && OBJECTION_SIGNALS.some(s => msg.includes(s))) {
    return STAGES.OBJECTION
  }

  if (!STAGES_PAST_CLOSE.has(currentStage) && CLOSE_SIGNALS.some(s => msg.includes(s))) {
    return STAGES.CLOSE
  }

  const rule = STAGE_PROGRESSION[currentStage]
  if (!rule) return STAGES.DISCOVERY

  if (turnCount >= rule.minTurns) {
    return rule.next
  }

  return currentStage
}

function getStageInstruction(stage) {
  return STAGE_INSTRUCTIONS[stage] || STAGE_INSTRUCTIONS[STAGES.DISCOVERY]
}

module.exports = { STAGES, getInitialStage, advanceStage, getStageInstruction }

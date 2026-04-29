# Implementation Plan: CreditQ AI Sales Agent — Knowledge Graph + Sales Script

## Task Type
- [x] Backend (primary — LLM system prompt, knowledge module, sales logic)
- [x] Fullstack (minor UI update to reflect sales agent persona)

---

## What We're Building

Transform the generic voice assistant into a **veteran sales agent** that:
1. Loads a structured CreditQ knowledge graph before every response
2. Follows a staged sales conversation flow
3. Persona: 20+ year senior sales, aggressive closer, never lies
4. Proactively pitches, handles objections, pushes toward close

---

## Technical Solution

### Architecture

```
session.start
     │
     ▼
[Knowledge Graph loaded into system prompt]
     │
     ▼
[Sales Stage Tracker] ── stage: greeting → discovery → pitch → objection → close
     │
     ▼
LLM (Groq llama-3.3-70b) ← system prompt = persona + knowledge + stage instruction
     │
     ▼
TTS (Sarvam) → audio
```

### Knowledge Graph Design

Not a flat string — structured JS object with sections:
- `company` — what CreditQ does, target audience, value props
- `plans` — all 7 plans, exact prices, features, wallet points
- `services` — CIR, defaulter reporting, settlement, verifications
- `salesPlaybook` — SPIN questions, objection handlers, close scripts
- `urgencyTriggers` — time-limited offers, loss-framing stats

At inference time: inject ALL sections (full context ~3KB, fits easily in llama-3.3-70b context).

### Sales Stage Tracker

Tracks conversation stage per session:
```
STAGES = greeting → discovery → pitch → handle_objection → close → post_close
```

Stage advances based on conversation turn count + keyword signals from LLM output.
System prompt instructions change per stage — agent knows what to do next.

---

## Implementation Steps

### Step 1: Create Knowledge Graph Module
**File**: `api/src/knowledge/creditq.js` (NEW)

```javascript
// Structured knowledge — agent "reads" this before every reply
const CREDITQ_KNOWLEDGE = {
  company: {
    name: "CreditQ",
    tagline: "India's first B2B Business Credit Management & Information Platform",
    target: "GST-registered MSMEs, suppliers, B2B sellers extending credit",
    coreProblem: "Businesses lose crores to payment defaults from unknown buyers",
    solution: "Check buyer creditworthiness BEFORE transacting, report defaulters, recover dues",
    requirement: "Must be GST-registered to use CreditQ",
    keyStats: [
      "India's first B2B credit bureau for MSMEs",
      "Covers structured settlement + legal notice delivery",
      "Automated payment reminders via SMS, call, email, WhatsApp"
    ]
  },

  services: {
    cir: {
      name: "Credit Information Report (CIR)",
      what: "Full credit profile of any GST-registered business in India",
      includes: ["Payment history", "Default records", "Director details", "GST verification", "Trade references"],
      purpose: "Know WHO you're selling to before giving credit"
    },
    defaulterReporting: {
      name: "Report Business Defaulters",
      what: "Add non-paying businesses to national database",
      effect: "Defaulter gets flagged — other suppliers can see it, creates settlement pressure",
      settlement: "Structured settlement process: defaulter pays to get removed from database"
    },
    verifications: {
      types: ["Aadhaar", "PAN", "GST", "Background check", "Police verification"],
      availability: "SILVER plan and above"
    },
    reminders: {
      channels: ["SMS", "Call", "Email", "WhatsApp"],
      availability: "SILVER plan and above",
      benefit: "Automated follow-ups without you lifting a finger"
    },
    legalSupport: {
      physicalNotice: "Registered post notice to defaulter — legal record",
      directorNotice: "Legal notice to ALL directors of defaulting company",
      availability: "DIAMOND (1/month), ENTERPRISE (2/month), ENTERPRISE PRO+ (2-3/month)"
    }
  },

  plans: [
    {
      name: "BASIC",
      price: 0,
      validity: "Limited access",
      walletPoints: 0,
      cirCost: 2000,
      addBusinessCost: 0,
      maxReportable: "Limited",
      keyLimitations: ["No verifications", "No dispute management", "No legal help", "No reminders"],
      pitch: "Free to start — but you can't protect yourself properly"
    },
    {
      name: "SILVER",
      price: 10000,
      validity: "1 year",
      walletPoints: 0,
      cirCost: 1800,
      addBusinessCost: 5000,
      addBusinessDiscount: "50% off",
      maxReportable: "Up to ₹2 lakhs",
      referralEarn: 500,
      referralDiscount: 500,
      includes: ["All verifications", "Dispute management", "Payment reminders", "Invoice auto-sharing"],
      pitch: "Entry-level protection — ideal for small suppliers with a few key buyers"
    },
    {
      name: "GOLD",
      price: 25000,
      validity: "1 year",
      walletPoints: 80000,
      cirCost: 1500,
      addBusinessCost: 8000,
      addBusinessDiscount: "60% off",
      addBusinessWalletReturn: 32000,
      maxReportable: "Up to ₹10 lakhs",
      referralEarn: 500,
      referralDiscount: 500,
      includes: ["Everything in SILVER", "80K wallet points upfront", "Faster recovery tools"],
      pitch: "Best for growing businesses with 10-50 buyers — wallet points offset your costs"
    },
    {
      name: "DIAMOND",
      price: 20000,
      validity: "2 years",
      walletPoints: 250000,
      cirCost: 1300,
      addBusinessCost: 15000,
      addBusinessDiscount: "70% off",
      addBusinessWalletReturn: 75000,
      maxReportable: "Up to ₹25 lakhs",
      referralEarn: 2000,
      referralDiscount: 1000,
      includes: ["Relationship manager", "1 physical notice/month", "2-year coverage"],
      pitch: "Most popular — 2 years for ₹20K. You have a dedicated RM. Best value per year"
    },
    {
      name: "ENTERPRISE",
      price: 70000,
      validity: "5 years",
      walletPoints: 700000,
      cirCost: 1200,
      addBusinessCost: 20000,
      addBusinessDiscount: "80% off",
      addBusinessWalletReturn: 140000,
      maxReportable: "Up to ₹50 lakhs",
      referralEarn: 3000,
      referralDiscount: 1500,
      includes: ["Personal legal assistance", "2 physical notices/month", "All director legal notices", "5-year coverage"],
      pitch: "For serious businesses — ₹14K/year for 5 years. One bad debt recovery pays for this 10x over"
    },
    {
      name: "ENTERPRISE PRO",
      price: 150000,
      validity: "7 years",
      walletPoints: 2400000,
      cirCost: 1000,
      addBusinessCost: 25000,
      addBusinessDiscount: "92% off",
      addBusinessWalletReturn: 200000,
      maxReportable: "No limit",
      referralEarn: 5000,
      referralDiscount: 2500,
      includes: ["Everything in ENTERPRISE", "No reportable limit", "7-year coverage", "Massive wallet points"],
      pitch: "For large-scale B2B operations. ₹21K/year for 7 years — enterprise-grade protection"
    },
    {
      name: "LIFETIME",
      price: 500000,
      validity: "Unlimited",
      walletPoints: "Unlimited",
      cirCost: 1000,
      addBusinessCost: 200000,
      addBusinessDiscount: "90% off",
      addBusinessWalletReturn: "Unlimited",
      maxReportable: "No limit",
      referralEarn: 5000,
      referralDiscount: 5000,
      includes: ["Everything, forever", "3 physical notices/month", "Unlimited wallet points", "Pay once, never again"],
      pitch: "One-time investment. Your grandchildren will still use this account. Zero recurring cost — ever"
    }
  ],

  salesPlaybook: {
    openingHook: "Every MSME in India loses on average ₹8-12 lakhs per year to bad debts. CreditQ exists to stop that.",
    
    discoveryQuestions: [
      "How many buyers do you currently extend credit to?",
      "Have you ever had a buyer default or delay payment significantly?",
      "What do you typically do when a buyer stops paying?",
      "How do you currently verify a new buyer before giving them credit?",
      "What's the largest single bad debt you've faced in the last 3 years?"
    ],

    painPoints: {
      "defaulters": "With our defaulter reporting, you put pressure on them without going to court. Most settle within 30 days.",
      "unknown_buyers": "Our CIR gives you their full payment history before you even ship the first invoice.",
      "recovery": "We don't just flag — we help you recover. Physical notices, legal support, settlement process.",
      "time_waste": "Our automated reminders follow up for you — SMS, call, WhatsApp — zero manual effort from you.",
      "cash_flow": "Bad debts kill cash flow. One good CIR before extending credit costs less than one defaulter."
    },

    objectionHandlers: {
      "too_expensive": "Let me ask you this — what did your last bad debt cost you? ₹10,000 for a year of protection is nothing compared to one defaulter. And with our wallet points, you earn back most of that on your first report.",
      "already_have_process": "Respecting that. But tell me — does your current process give you a defaulter's history across all of India's suppliers? Or automated legal notices? That's what CreditQ adds.",
      "will_think_about_it": "Of course — but I'll tell you what I tell all my clients: defaulters don't wait. Every day you don't check, you're extending credit on trust. Let me just get you started on the BASIC plan — it's free. You can see the platform yourself.",
      "not_needed_yet": "You haven't needed it yet — until you do. The businesses who call us after a default wish they'd joined before. Prevention costs 10x less than cure.",
      "need_to_discuss_partner": "Absolutely. While you discuss — can I send you a report on one of your current buyers? It's free on BASIC. That way your partner sees exactly what CreditQ gives you.",
      "competitor_exists": "Good — you're researching. Tell me which one. I'll tell you exactly what we do that they don't. Spoiler: nobody else has physical notice delivery and settlement in one platform."
    },

    closeScripts: {
      softClose: "Based on what you've told me, the DIAMOND plan fits you perfectly — 2 years, dedicated relationship manager, covers up to ₹25 lakhs. Shall I walk you through the onboarding?",
      urgencyClose: "We have a promotional pricing right now — that 20% discount on DIAMOND won't last. If you're serious about protecting your business, this week is the time.",
      assumptiveClose: "Let me get your GST number and we'll have your account active in 10 minutes. What's the best email for your subscription details?",
      fenceSitterClose: "You've already told me you've had payment issues. You know you need this. The only question is which plan — SILVER to start, or DIAMOND for full coverage. Which feels right?",
      roiClose: "If CreditQ helps you avoid even ONE bad debt this year, what would that save you? ₹2 lakhs? ₹5 lakhs? You're paying ₹10,000 for SILVER. That's a 20x return minimum."
    },

    urgencyTriggers: [
      "Limited-time pricing on DIAMOND and ENTERPRISE",
      "GST-registered businesses who join now get priority onboarding",
      "Every month without CreditQ is a month of unprotected credit exposure"
    ]
  }
}

module.exports = { CREDITQ_KNOWLEDGE }
```

**Deliverable**: Importable knowledge graph, all CreditQ data structured.

---

### Step 2: Create Sales Script / Stage Logic
**File**: `api/src/salesScript.js` (NEW)

```javascript
// Manages sales stage per session + builds stage-specific prompt instructions

const STAGES = {
  GREETING: 'greeting',
  DISCOVERY: 'discovery', 
  PITCH: 'pitch',
  OBJECTION: 'objection',
  CLOSE: 'close',
  POST_CLOSE: 'post_close'
}

// Stage instructions injected into system prompt
const STAGE_INSTRUCTIONS = {
  greeting: `
CURRENT STAGE: GREETING
- Start with a warm, confident introduction as CreditQ's senior sales advisor
- Immediately explain what CreditQ does in ONE punchy sentence
- Mention the core pain point: "MSMEs lose crores to bad debts"
- Ask ONE qualifying question to start discovery
- Keep it under 4 sentences — this is voice
`,
  discovery: `
CURRENT STAGE: DISCOVERY
- You're uncovering pain. Ask ONE pointed question about their credit situation
- Listen for: number of buyers, past defaults, recovery challenges, verification gaps
- When you detect a pain point, acknowledge it then move to pitch
- Mirror their language. If they say "customers delay", use "delay" not "default"
- Stay at max 3 sentences
`,
  pitch: `
CURRENT STAGE: PITCH
- You have their pain point. Now match it to the RIGHT plan
- Lead with the problem they named, then present the solution
- Name a specific plan with 2-3 concrete benefits
- Use ROI framing: "One bad debt recovery pays for this plan 10 times over"
- End with a soft trial close: "Does this sound like what you need?"
`,
  objection: `
CURRENT STAGE: HANDLING OBJECTION
- You've hit resistance. Do NOT back down — reframe
- Acknowledge their concern in ONE word ("Fair", "Understood", "Valid")
- Pivot immediately: "Here's the thing though —"
- Use a concrete counter: cost vs. bad debt loss, or offer the free BASIC tier
- End with a question to re-engage: "Does that make sense?"
`,
  close: `
CURRENT STAGE: CLOSING
- They're ready. Don't over-explain — move to action
- Use assumptive close: "Let's get your account set up — what's your GST number?"
- If hesitant, offer urgency: "This pricing is promotional — this week only"
- If they stall, offer BASIC (free) as foot-in-door: "Start free, upgrade when you're ready"
- ONE clear call to action per response
`,
  post_close: `
CURRENT STAGE: POST-CLOSE / FOLLOW-UP
- They've committed or said they'll call back. Wrap up warmly
- Confirm next steps clearly
- Give them ONE reason to remember CreditQ: the core value in 1 sentence
- Thank them genuinely — you just protected their business
`
}

function getInitialStage() {
  return STAGES.GREETING
}

function advanceStage(currentStage, turnCount, lastReply) {
  const reply = (lastReply || '').toLowerCase()
  
  // Detect objection keywords regardless of stage
  const objectionSignals = ['expensive', 'costly', 'think about', 'not sure', 'discuss', 'partner', 'later', 'competitor', 'already have', 'not needed']
  if (objectionSignals.some(s => reply.includes(s))) {
    return STAGES.OBJECTION
  }
  
  // Detect close-readiness signals
  const closeSignals = ['interested', 'sounds good', 'tell me more', 'how do i', 'sign up', 'register', 'gst', 'proceed']
  if (closeSignals.some(s => reply.includes(s))) {
    return STAGES.CLOSE
  }
  
  // Natural stage progression by turn count
  const progressionMap = {
    [STAGES.GREETING]: turnCount >= 1 ? STAGES.DISCOVERY : STAGES.GREETING,
    [STAGES.DISCOVERY]: turnCount >= 3 ? STAGES.PITCH : STAGES.DISCOVERY,
    [STAGES.PITCH]: turnCount >= 5 ? STAGES.CLOSE : STAGES.PITCH,
    [STAGES.OBJECTION]: STAGES.PITCH, // after handling objection, go back to pitch
    [STAGES.CLOSE]: STAGES.POST_CLOSE,
    [STAGES.POST_CLOSE]: STAGES.POST_CLOSE
  }
  
  return progressionMap[currentStage] || STAGES.DISCOVERY
}

function getStageInstruction(stage) {
  return STAGE_INSTRUCTIONS[stage] || STAGE_INSTRUCTIONS[STAGES.DISCOVERY]
}

module.exports = { STAGES, getInitialStage, advanceStage, getStageInstruction }
```

**Deliverable**: Stage machine that advances conversation, returns per-stage prompt instructions.

---

### Step 3: Rewrite LLM Module with Knowledge + Persona
**File**: `api/src/llm.js` (MODIFY — replace system prompt, inject knowledge graph)

```javascript
const Groq = require('groq-sdk')
const { CREDITQ_KNOWLEDGE } = require('./knowledge/creditq')
const { getStageInstruction } = require('./salesScript')

function buildSystemPrompt(stage) {
  const k = CREDITQ_KNOWLEDGE
  
  // Serialize plans for prompt
  const plansText = k.plans.map(p => 
    `- ${p.name}: ₹${p.price?.toLocaleString() || p.price} | ${p.validity} | CIR: ₹${p.cirCost} | ${p.pitch}`
  ).join('\n')
  
  // Serialize objection handlers
  const objectionText = Object.entries(k.salesPlaybook.objectionHandlers)
    .map(([key, val]) => `  [${key}]: ${val}`)
    .join('\n')

  return `
You are Rajesh Kumar, CreditQ's most senior sales advisor with 23 years of B2B sales experience.
You are known across the industry for closing deals others give up on.
You are ambitious, persistent, and intensely focused on helping businesses protect their revenue.
You NEVER lie or misrepresent — your reputation is built on trust and results.
You speak in short, punchy sentences because this is a voice call.

=== CREDITQ KNOWLEDGE BASE (read this before every response) ===

COMPANY:
${k.company.tagline}
Target: ${k.company.target}
Core problem: ${k.company.coreProblem}
Solution: ${k.company.solution}
Requirement: ${k.company.requirement}

KEY SERVICES:
- Credit Information Report (CIR): Full credit profile of any GST business. Cost varies by plan.
- Defaulter Reporting: Add non-payers to national database. Creates settlement pressure.
- Verifications: Aadhaar, PAN, GST, Background, Police — SILVER plan and above.
- Automated Reminders: SMS, call, email, WhatsApp follow-ups — hands-free collections.
- Legal Support: Physical notices by registered post, director notices — DIAMOND and above.

MEMBERSHIP PLANS:
${plansText}

SALES PLAYBOOK:
Opening hook: "${k.salesPlaybook.openingHook}"

Key objection responses:
${objectionText}

Close scripts: soft close, urgency close, ROI close, assumptive close — use context to pick the right one.

=== END KNOWLEDGE BASE ===

PERSONA RULES:
1. MAX 3 sentences per response — voice call, not a lecture
2. Always end with either a question or a call to action
3. If they mention a pain point, NAME the specific CreditQ solution immediately
4. Never apologize for being direct — you're saving their business
5. If they say no, reframe — never accept "no" as final on first pass
6. Use Indian business context: mention "crores", "MSME", "GST", "B2B"

${getStageInstruction(stage)}
`.trim()
}

async function getReply(transcript, history = [], stage = 'greeting') {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY not configured')

  const groq = new Groq({ apiKey })

  const messages = [
    { role: 'system', content: buildSystemPrompt(stage) },
    ...history,
    { role: 'user', content: transcript },
  ]

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages,
    max_tokens: 200,  // slightly larger to handle richer responses
    temperature: 0.75,
  })

  return response.choices[0].message.content
}

module.exports = { getReply }
```

**Deliverable**: LLM now loads full knowledge graph + stage-specific instructions on every call.

---

### Step 4: Wire Stage Tracker into Session (index.js)
**File**: `api/src/index.js` (MODIFY — add stage to session, pass to getReply, advance after each turn)

Changes:
1. Add `stage` and `turnCount` to session object
2. Call `advanceStage()` after each user turn using last user transcript keywords
3. Pass `stage` to `getReply()`

```javascript
// Session init change:
const session = {
  id: null,
  chunks: [],
  chunkCount: 0,
  totalBytes: 0,
  history: [],
  stage: getInitialStage(),   // ADD THIS
  turnCount: 0,               // ADD THIS
}

// In processSession(), after LLM reply:
session.turnCount++
session.stage = advanceStage(session.stage, session.turnCount, transcript)

// Pass stage to getReply:
const replyText = await getReply(transcript, session.history, session.stage)
```

**Deliverable**: Each session tracks its sales stage. Agent evolves through the sales funnel per conversation.

---

### Step 5: Update Greeting
**File**: `api/src/index.js` (MODIFY — update GREETING constant)

```javascript
const GREETING =
  "Hello! I'm Rajesh, CreditQ's senior sales advisor — 23 years in B2B credit. " +
  "CreditQ is India's first business credit platform — we help MSMEs stop losing money to payment defaults. " +
  "Tell me, how many buyers are you currently extending credit to?"
```

**Deliverable**: Greeting immediately establishes persona, pitches value, opens discovery.

---

### Step 6 (Optional): Update UI Label
**File**: `client/src/App.tsx` (MINOR MODIFY)

Change heading from "CreditQ Voice Agent" to "CreditQ Sales Advisor" to match persona.

---

## Key Files Summary

| File | Operation | Description |
|------|-----------|-------------|
| `api/src/knowledge/creditq.js` | CREATE | Full CreditQ knowledge graph — all plans, services, playbook |
| `api/src/salesScript.js` | CREATE | Stage machine: greeting→discovery→pitch→objection→close |
| `api/src/llm.js` | MODIFY | Inject knowledge + persona + stage instruction into system prompt |
| `api/src/index.js` | MODIFY | Add stage/turnCount to session, wire advanceStage(), update greeting |
| `client/src/App.tsx` | MINOR | Update heading label |

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| System prompt too large → token cost | Knowledge is ~3KB, llama-3.3-70b has 128K context — no issue |
| Stage advances incorrectly | Keyword signals are lightweight — worst case: agent re-pitches, still valid |
| Agent sounds robotic with stage instructions | Temperature 0.75 + short max_tokens keeps voice natural |
| Plans data goes stale | All plan data in one file (`knowledge/creditq.js`) — easy to update |
| Agent over-closes aggressively | Persona rule "never lie" grounds it; stage instruction language is assertive not deceptive |

---

## SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: N/A (no external model called — plan derived from codebase exploration)
- GEMINI_SESSION: N/A

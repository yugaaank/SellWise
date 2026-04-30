'use strict'

const Groq = require('groq-sdk')
const { CREDITQ_KNOWLEDGE } = require('./knowledge/creditq')
const { getStageInstruction } = require('./salesScript')

function buildSystemPrompt(stage) {
  const k = CREDITQ_KNOWLEDGE

  const plansText = k.plans
    .map(p => {
      const price = typeof p.price === 'number' ? `₹${p.price.toLocaleString('en-IN')}` : String(p.price)
      return `- ${p.name}: ${price} | ${p.validity} | CIR: ₹${p.cirCost}/report | ${p.pitch}`
    })
    .join('\n')

  const objectionText = Object.entries(k.salesPlaybook.objectionHandlers)
    .map(([key, val]) => `  [${key}]: ${val}`)
    .join('\n')

  const closeText = Object.entries(k.salesPlaybook.closeScripts)
    .map(([key, val]) => `  [${key}]: ${val}`)
    .join('\n')

  return `You are Arjun Mehta — a senior business credit advisor at CreditQ with 15+ years working with Indian MSMEs across manufacturing, trading, and services.
You are calm, measured, and professional. Not a pushy salesperson — a trusted advisor who knows that unprotected credit destroys businesses.
You NEVER lie or misrepresent. Your reputation is built on trust, data, and results.
You speak in short, punchy sentences — this is a voice call, not an email.

=== CREDITQ KNOWLEDGE BASE (read before every response) ===

COMPANY:
${k.company.tagline}
Target: ${k.company.target}
Core problem: ${k.company.coreProblem}
Solution: ${k.company.solution}
Requirement: ${k.company.requirement}

KEY SERVICES:
- Credit Information Report (CIR): Full credit profile of any GST-registered business. Cost varies by plan.
- Defaulter Reporting: Add non-payers to national database. Creates settlement pressure — most settle in 30 days.
- Verifications: Aadhaar, PAN, GST, Background, Police — SILVER plan and above.
- Automated Reminders: SMS, call, email, WhatsApp follow-ups — hands-free collections.
- Legal Support: Physical notices via registered post, director notices — DIAMOND and above.

MEMBERSHIP PLANS:
${plansText}

OPENING HOOK:
"${k.salesPlaybook.openingHook}"

OBJECTION RESPONSES (use when prospect pushes back):
${objectionText}

CLOSE SCRIPTS (pick based on prospect signals):
${closeText}

=== END KNOWLEDGE BASE ===

PERSONA RULES:
1. MAX 3 sentences per response — voice call, not a lecture
2. Always end with a question or a clear call to action
3. When they mention a pain point, NAME the specific CreditQ solution immediately
4. Never apologize for being direct — you are protecting their business
5. If they say no, reframe — never accept the first no as final
6. Use Indian business context naturally: crores, lakhs, MSME, GST, B2B
7. Write in natural Hinglish — Devanagari script for Hindi words, Roman script for English words. Exactly how educated Indian professionals text on WhatsApp. This is critical for correct TTS pronunciation. Examples: "देखिए, एक बात clear करते हैं —", "आपका buyer 60 दिन से payment रोक रहा है, वो effectively आपका capital ले के चल रहा है.", "बिल्कुल समझ सकता हूँ — लेकिन risk कब तक लोगे?" Always Devanagari for: मैं, आप, हाँ, नहीं, देखिए, बिल्कुल, क्या, कैसे, है, हैं, था, हूँ, वो, और, लेकिन, तो, भाई, अच्छा, बताओ, करो, चाहिए, कितने, उनका, आपका, हम, रहा, रही, सकता. Keep English business terms in Roman: payment, credit, buyer, seller, GST, MSME, plan, business, report, risk, defaulter, cashflow.
8. SPEECH-OPTIMIZED NUMBERS: NEVER use the "₹" symbol or hyphens in ranges (e.g., 1-2). Instead of "₹5000", write "5000 rupees" or "5000 रुपये". Instead of "1-2 Lakh", write "1 से 2 Lakh" or "1 to 2 Lakh". Always use words like "से" or "to" for ranges. This ensures the voice engine doesn't say "minus" or "rupee sign".

${getStageInstruction(stage)}`.trim()
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
    model: 'llama-3.1-8b-instant',
    messages,
    max_tokens: 200,
    temperature: 0.5,
  })

  return response.choices[0].message.content
}

async function* getReplyStream(transcript, history = [], stage = 'greeting', signal = null) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY not configured')

  // Check for abort before starting
  if (signal?.aborted) {
    throw new Error('LLM aborted')
  }

  const groq = new Groq({ apiKey })

  const messages = [
    { role: 'system', content: buildSystemPrompt(stage) },
    ...history,
    { role: 'user', content: transcript },
  ]

  const stream = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages,
    max_tokens: 200,
    temperature: 0.5,
    stream: true,
  })

  for await (const chunk of stream) {
    // Check for abort signal during streaming (for barge-in)
    if (signal?.aborted) {
      throw new Error('LLM aborted')
    }
    
    const token = chunk.choices[0]?.delta?.content
    if (token) yield token
  }
}

module.exports = { getReply, getReplyStream, buildSystemPrompt }

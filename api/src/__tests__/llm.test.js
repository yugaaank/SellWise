'use strict'

async function* fakeTokenStream(tokens) {
  for (const token of tokens) {
    yield { choices: [{ delta: { content: token } }] }
  }
}

const mockCreate = jest.fn().mockResolvedValue({
  choices: [{ message: { content: 'Test reply from agent.' } }]
})

// Mock groq-sdk — no real API calls in tests
jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }))
})

const { getReply, getReplyStream, buildSystemPrompt } = require('../llm')

describe('buildSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = buildSystemPrompt('greeting')
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('includes CreditQ knowledge base section', () => {
    const prompt = buildSystemPrompt('greeting')
    expect(prompt).toMatch(/CREDITQ KNOWLEDGE BASE/i)
  })

  it('includes all 7 plan names', () => {
    const prompt = buildSystemPrompt('greeting')
    expect(prompt).toMatch(/BASIC/)
    expect(prompt).toMatch(/SILVER/)
    expect(prompt).toMatch(/GOLD/)
    expect(prompt).toMatch(/DIAMOND/)
    expect(prompt).toMatch(/ENTERPRISE/)
    expect(prompt).toMatch(/LIFETIME/)
  })

  it('includes stage instruction for greeting', () => {
    const prompt = buildSystemPrompt('greeting')
    expect(prompt.toLowerCase()).toMatch(/greet|stage/i)
  })

  it('includes stage instruction for close', () => {
    const prompt = buildSystemPrompt('close')
    expect(prompt.toLowerCase()).toMatch(/clos|action/i)
  })

  it('includes persona — sales advisor with experience', () => {
    const prompt = buildSystemPrompt('greeting')
    expect(prompt).toMatch(/advisor|senior|years/i)
  })

  it('includes objection handlers', () => {
    const prompt = buildSystemPrompt('objection')
    expect(prompt.toLowerCase()).toMatch(/objection|expensive|think about/i)
  })

  it('includes Hinglish language instruction', () => {
    const prompt = buildSystemPrompt('greeting')
    expect(prompt).toMatch(/hindi|hinglish|aap|bhai|dekhiye/i)
  })

  it('persona speaks as CreditQ representative', () => {
    const prompt = buildSystemPrompt('greeting')
    expect(prompt).toMatch(/CreditQ/i)
  })
})

describe('getReply', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key'
  })

  afterEach(() => {
    delete process.env.GROQ_API_KEY
  })

  it('returns a string reply', async () => {
    const reply = await getReply('Hello', [], 'greeting')
    expect(typeof reply).toBe('string')
    expect(reply.length).toBeGreaterThan(0)
  })

  it('throws when GROQ_API_KEY is missing', async () => {
    delete process.env.GROQ_API_KEY
    await expect(getReply('Hello', [], 'greeting')).rejects.toThrow('GROQ_API_KEY not configured')
  })

  it('passes history messages to the model', async () => {
    const history = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' }
    ]
    await getReply('Tell me more', history, 'discovery')

    const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0]
    const historyInMessages = callArgs.messages.filter(m => m.role === 'user' || m.role === 'assistant')
    expect(historyInMessages.length).toBeGreaterThanOrEqual(2)
  })

  it('defaults stage to greeting when not provided', async () => {
    const reply = await getReply('Hello', [])
    expect(typeof reply).toBe('string')
  })
})

describe('getReplyStream', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-key'
    jest.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.GROQ_API_KEY
  })

  it('throws when GROQ_API_KEY is missing', async () => {
    delete process.env.GROQ_API_KEY
    const gen = getReplyStream('Hello', [], 'greeting')
    await expect(gen.next()).rejects.toThrow('GROQ_API_KEY not configured')
  })

  it('yields string tokens from stream', async () => {
    mockCreate.mockResolvedValueOnce(fakeTokenStream(['Hello', ', ', 'how', ' are', ' you?']))

    const tokens = []
    for await (const token of getReplyStream('Hi', [], 'greeting')) {
      tokens.push(token)
    }

    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.every(t => typeof t === 'string')).toBe(true)
  })

  it('concatenated tokens form the full reply', async () => {
    mockCreate.mockResolvedValueOnce(fakeTokenStream(['Dekhiye,', ' aap', ' sahi', ' pooch', ' rahe', ' ho.']))

    const tokens = []
    for await (const token of getReplyStream('Tell me about GOLD plan', [], 'pitch')) {
      tokens.push(token)
    }

    expect(tokens.join('')).toBe('Dekhiye, aap sahi pooch rahe ho.')
  })

  it('skips chunks with no content (undefined delta)', async () => {
    async function* mixedStream() {
      yield { choices: [{ delta: { content: 'Hello' } }] }
      yield { choices: [{ delta: {} }] }             // no content field
      yield { choices: [{ delta: { content: null } }] } // null content
      yield { choices: [{ delta: { content: ' world' } }] }
    }
    mockCreate.mockResolvedValueOnce(mixedStream())

    const tokens = []
    for await (const token of getReplyStream('Hi', [], 'greeting')) {
      tokens.push(token)
    }

    expect(tokens).toEqual(['Hello', ' world'])
  })

  it('calls Groq API with stream:true', async () => {
    mockCreate.mockResolvedValueOnce(fakeTokenStream(['ok']))

    // consume
    for await (const _ of getReplyStream('Hi', [], 'greeting')) { }

    const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0]
    expect(callArgs.stream).toBe(true)
  })

  it('passes history to the model', async () => {
    mockCreate.mockResolvedValueOnce(fakeTokenStream(['yes']))

    const history = [
      { role: 'user', content: 'test' },
      { role: 'assistant', content: 'reply' }
    ]

    for await (const _ of getReplyStream('follow up', history, 'discovery')) { }

    const callArgs = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0]
    const msgs = callArgs.messages
    expect(msgs.some(m => m.content === 'test')).toBe(true)
  })
})

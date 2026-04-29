'use strict'

// Mock global fetch
const mockReader = {
  read: jest.fn()
}

const mockResponseBody = {
  getReader: jest.fn().mockReturnValue(mockReader)
}

global.fetch = jest.fn()

const { synthesize, synthesizeStream } = require('../tts')

describe('synthesize', () => {
  beforeEach(() => {
    process.env.SARVAM_API_KEY = 'test-sarvam-key'
    jest.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.SARVAM_API_KEY
  })

  it('throws when SARVAM_API_KEY missing', async () => {
    delete process.env.SARVAM_API_KEY
    await expect(synthesize('hello')).rejects.toThrow('SARVAM_API_KEY not configured')
  })

  it('calls non-streaming TTS endpoint', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ audios: [Buffer.from('audio-data').toString('base64')] })
    })

    const buf = await synthesize('hello world')
    expect(buf).toBeInstanceOf(Buffer)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/text-to-speech'),
      expect.objectContaining({ method: 'POST' })
    )
    // Must NOT call streaming endpoint
    const url = global.fetch.mock.calls[0][0]
    expect(url).not.toContain('/stream')
  })

  it('throws on non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => 'validation error'
    })
    await expect(synthesize('hello')).rejects.toThrow('422')
  })
})

describe('synthesizeStream', () => {
  beforeEach(() => {
    process.env.SARVAM_API_KEY = 'test-sarvam-key'
    jest.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.SARVAM_API_KEY
  })

  it('throws when SARVAM_API_KEY missing', async () => {
    delete process.env.SARVAM_API_KEY
    await expect(synthesizeStream('hello', jest.fn())).rejects.toThrow('SARVAM_API_KEY not configured')
  })

  it('calls streaming endpoint /text-to-speech/stream', async () => {
    mockReader.read
      .mockResolvedValueOnce({ done: true, value: undefined })

    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: mockResponseBody
    })

    await synthesizeStream('hello', jest.fn())

    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('/text-to-speech/stream')
  })

  it('calls onChunk for each received chunk', async () => {
    const chunk1 = new Uint8Array([1, 2, 3])
    const chunk2 = new Uint8Array([4, 5, 6])
    mockReader.read
      .mockResolvedValueOnce({ done: false, value: chunk1 })
      .mockResolvedValueOnce({ done: false, value: chunk2 })
      .mockResolvedValueOnce({ done: true, value: undefined })

    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: mockResponseBody
    })

    const onChunk = jest.fn()
    await synthesizeStream('hello world', onChunk)

    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(onChunk).toHaveBeenNthCalledWith(1, chunk1)
    expect(onChunk).toHaveBeenNthCalledWith(2, chunk2)
  })

  it('calls onChunk with Uint8Array chunks', async () => {
    const chunk = new Uint8Array([72, 73])
    mockReader.read
      .mockResolvedValueOnce({ done: false, value: chunk })
      .mockResolvedValueOnce({ done: true, value: undefined })

    global.fetch.mockResolvedValueOnce({
      ok: true,
      body: mockResponseBody
    })

    const onChunk = jest.fn()
    await synthesizeStream('hi', onChunk)

    expect(onChunk.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
  })

  it('throws on non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    })
    await expect(synthesizeStream('hello', jest.fn())).rejects.toThrow('401')
  })

  it('sends correct speaker and model params', async () => {
    mockReader.read.mockResolvedValueOnce({ done: true, value: undefined })
    global.fetch.mockResolvedValueOnce({ ok: true, body: mockResponseBody })

    await synthesizeStream('test', jest.fn())

    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.speaker).toBe('shubh')
    expect(body.model).toBe('bulbul:v3')
    expect(body.output_audio_codec).toBe('linear16')
  })
})

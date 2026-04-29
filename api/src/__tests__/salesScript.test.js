'use strict'

const { STAGES, getInitialStage, advanceStage, getStageInstruction } = require('../salesScript')

describe('salesScript', () => {
  describe('getInitialStage', () => {
    it('returns greeting as initial stage', () => {
      expect(getInitialStage()).toBe(STAGES.GREETING)
    })
  })

  describe('advanceStage', () => {
    it('stays in greeting on turn 0', () => {
      expect(advanceStage(STAGES.GREETING, 0, '')).toBe(STAGES.GREETING)
    })

    it('advances greeting→discovery after turn 1', () => {
      expect(advanceStage(STAGES.GREETING, 1, 'I have 20 buyers')).toBe(STAGES.DISCOVERY)
    })

    it('advances discovery→pitch after turn 3', () => {
      expect(advanceStage(STAGES.DISCOVERY, 3, 'we lost money')).toBe(STAGES.PITCH)
    })

    it('advances pitch→close after turn 5', () => {
      expect(advanceStage(STAGES.PITCH, 5, 'okay')).toBe(STAGES.CLOSE)
    })

    it('triggers objection stage when user says too expensive', () => {
      expect(advanceStage(STAGES.PITCH, 2, 'that seems too expensive for us')).toBe(STAGES.OBJECTION)
    })

    it('triggers objection stage when user wants to think about it', () => {
      expect(advanceStage(STAGES.DISCOVERY, 2, 'let me think about it')).toBe(STAGES.OBJECTION)
    })

    it('triggers objection stage when user mentions discussing with partner', () => {
      expect(advanceStage(STAGES.PITCH, 3, 'I need to discuss with my partner')).toBe(STAGES.OBJECTION)
    })

    it('triggers close stage when user says sounds good', () => {
      expect(advanceStage(STAGES.PITCH, 3, 'this sounds good')).toBe(STAGES.CLOSE)
    })

    it('triggers close stage when user asks how to sign up', () => {
      expect(advanceStage(STAGES.PITCH, 3, 'how do I sign up')).toBe(STAGES.CLOSE)
    })

    it('triggers close stage when user mentions GST', () => {
      expect(advanceStage(STAGES.PITCH, 3, 'my GST number is 29ABCDE')).toBe(STAGES.CLOSE)
    })

    it('advances from objection back to pitch', () => {
      expect(advanceStage(STAGES.OBJECTION, 4, 'I understand now')).toBe(STAGES.PITCH)
    })

    it('advances close→post_close', () => {
      expect(advanceStage(STAGES.CLOSE, 6, 'yes proceed')).toBe(STAGES.POST_CLOSE)
    })

    it('stays in post_close once reached', () => {
      expect(advanceStage(STAGES.POST_CLOSE, 10, 'thanks')).toBe(STAGES.POST_CLOSE)
    })
  })

  describe('getStageInstruction', () => {
    it('returns non-empty string for each stage', () => {
      Object.values(STAGES).forEach(stage => {
        const instruction = getStageInstruction(stage)
        expect(typeof instruction).toBe('string')
        expect(instruction.length).toBeGreaterThan(10)
      })
    })

    it('greeting instruction mentions introduction', () => {
      const instruction = getStageInstruction(STAGES.GREETING)
      expect(instruction.toLowerCase()).toMatch(/greet|introduc|stage/i)
    })

    it('close instruction mentions call to action or close', () => {
      const instruction = getStageInstruction(STAGES.CLOSE)
      expect(instruction.toLowerCase()).toMatch(/clos|action|gst|sign|proceed/i)
    })

    it('objection instruction mentions reframe or objection handling', () => {
      const instruction = getStageInstruction(STAGES.OBJECTION)
      expect(instruction.toLowerCase()).toMatch(/objection|resist|reframe|pivot/i)
    })

    it('returns fallback for unknown stage', () => {
      const instruction = getStageInstruction('unknown_stage')
      expect(typeof instruction).toBe('string')
      expect(instruction.length).toBeGreaterThan(10)
    })
  })
})

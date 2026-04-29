'use strict'

const { CREDITQ_KNOWLEDGE } = require('../knowledge/creditq')

describe('CREDITQ_KNOWLEDGE', () => {
  describe('company', () => {
    it('has required company fields', () => {
      const { company } = CREDITQ_KNOWLEDGE
      expect(company.name).toBe('CreditQ')
      expect(company.tagline).toBeTruthy()
      expect(company.target).toBeTruthy()
      expect(company.coreProblem).toBeTruthy()
      expect(company.solution).toBeTruthy()
      expect(company.requirement).toBeTruthy()
    })
  })

  describe('plans', () => {
    it('has exactly 7 plans', () => {
      expect(CREDITQ_KNOWLEDGE.plans).toHaveLength(7)
    })

    it('includes all expected plan names', () => {
      const names = CREDITQ_KNOWLEDGE.plans.map(p => p.name)
      expect(names).toContain('BASIC')
      expect(names).toContain('SILVER')
      expect(names).toContain('GOLD')
      expect(names).toContain('DIAMOND')
      expect(names).toContain('ENTERPRISE')
      expect(names).toContain('ENTERPRISE PRO')
      expect(names).toContain('LIFETIME')
    })

    it('each plan has name, price, validity, cirCost, pitch', () => {
      CREDITQ_KNOWLEDGE.plans.forEach(plan => {
        expect(plan.name).toBeTruthy()
        expect(plan.validity).toBeTruthy()
        expect(plan.cirCost).toBeGreaterThan(0)
        expect(plan.pitch).toBeTruthy()
        // price can be 0 for BASIC
        expect(typeof plan.price === 'number' || typeof plan.price === 'string').toBe(true)
      })
    })

    it('BASIC plan is free', () => {
      const basic = CREDITQ_KNOWLEDGE.plans.find(p => p.name === 'BASIC')
      expect(basic.price).toBe(0)
    })

    it('DIAMOND plan costs 50000', () => {
      const diamond = CREDITQ_KNOWLEDGE.plans.find(p => p.name === 'DIAMOND')
      expect(diamond.price).toBe(50000)
    })

    it('ENTERPRISE PRO plan costs 150000', () => {
      const ep = CREDITQ_KNOWLEDGE.plans.find(p => p.name === 'ENTERPRISE PRO')
      expect(ep.price).toBe(150000)
    })

    it('LIFETIME plan has unlimited wallet points', () => {
      const lifetime = CREDITQ_KNOWLEDGE.plans.find(p => p.name === 'LIFETIME')
      expect(String(lifetime.walletPoints).toLowerCase()).toMatch(/unlimited/)
    })
  })

  describe('services', () => {
    it('has cir, defaulterReporting, verifications, reminders, legalSupport', () => {
      const { services } = CREDITQ_KNOWLEDGE
      expect(services.cir).toBeTruthy()
      expect(services.defaulterReporting).toBeTruthy()
      expect(services.verifications).toBeTruthy()
      expect(services.reminders).toBeTruthy()
      expect(services.legalSupport).toBeTruthy()
    })

    it('CIR has what and purpose fields', () => {
      const { cir } = CREDITQ_KNOWLEDGE.services
      expect(cir.what).toBeTruthy()
      expect(cir.purpose).toBeTruthy()
    })
  })

  describe('salesPlaybook', () => {
    it('has discoveryQuestions array with at least 3 questions', () => {
      expect(CREDITQ_KNOWLEDGE.salesPlaybook.discoveryQuestions.length).toBeGreaterThanOrEqual(3)
    })

    it('has objectionHandlers object with at least 4 keys', () => {
      const keys = Object.keys(CREDITQ_KNOWLEDGE.salesPlaybook.objectionHandlers)
      expect(keys.length).toBeGreaterThanOrEqual(4)
    })

    it('has closeScripts with at least 3 scripts', () => {
      const keys = Object.keys(CREDITQ_KNOWLEDGE.salesPlaybook.closeScripts)
      expect(keys.length).toBeGreaterThanOrEqual(3)
    })

    it('has openingHook string', () => {
      expect(typeof CREDITQ_KNOWLEDGE.salesPlaybook.openingHook).toBe('string')
      expect(CREDITQ_KNOWLEDGE.salesPlaybook.openingHook.length).toBeGreaterThan(10)
    })

    it('has hinglishPhrases array with at least 4 entries', () => {
      const { hinglishPhrases } = CREDITQ_KNOWLEDGE.salesPlaybook
      expect(Array.isArray(hinglishPhrases)).toBe(true)
      expect(hinglishPhrases.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('new services', () => {
    it('has businessCreditManagement with Tally/ERP integration', () => {
      const { services } = CREDITQ_KNOWLEDGE
      expect(services.businessCreditManagement).toBeDefined()
      expect(JSON.stringify(services.businessCreditManagement)).toMatch(/tally|erp|integrat/i)
    })

    it('has msme service', () => {
      const { services } = CREDITQ_KNOWLEDGE
      expect(services.msme).toBeDefined()
      expect(services.msme.name).toBeTruthy()
    })

    it('has settlement service', () => {
      const { services } = CREDITQ_KNOWLEDGE
      expect(services.settlement).toBeDefined()
    })
  })

  describe('defaulterProcess', () => {
    it('exists and mentions CA certificate requirement', () => {
      expect(CREDITQ_KNOWLEDGE.defaulterProcess).toBeDefined()
      const text = JSON.stringify(CREDITQ_KNOWLEDGE.defaulterProcess)
      expect(text).toMatch(/CA|certificate/i)
    })

    it('mentions PAN fallback when defaulter has no GSTIN', () => {
      const text = JSON.stringify(CREDITQ_KNOWLEDGE.defaulterProcess)
      expect(text).toMatch(/PAN/i)
    })

    it('mentions defaulter notification', () => {
      const text = JSON.stringify(CREDITQ_KNOWLEDGE.defaulterProcess)
      expect(text).toMatch(/notif/i)
    })
  })

  describe('contact', () => {
    it('has support email containing creditq.in', () => {
      expect(CREDITQ_KNOWLEDGE.contact).toBeDefined()
      expect(CREDITQ_KNOWLEDGE.contact).toMatch(/creditq\.in/)
    })
  })
})

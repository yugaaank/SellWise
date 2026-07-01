# Project Planning and Tracking: SlipWise (AI Sales Agent)

## 1. Project Overview
This project focuses on the development of a customizable, AI-powered voice sales agent tailored as a generic B2B/B2C sales solution. The voice agent features real-time voice interaction, natural English language support, adaptive Voice Activity Detection (VAD) for noisy environments, and user barge-in support.

The technology stack utilizes React/Vite for the frontend and Node.js/Express with WebSockets for the backend. AI integrations include Groq for Speech-to-Text (Whisper) and LLM (Llama 3.1), and Sarvam AI for Text-to-Speech synthesis.

## 2. Work Breakdown Structure (WBS)
To effectively plan and track the project, the scope has been divided into the following structured phases:
- **Phase 1: Planning & Setup** (Requirements gathering, System architecture design, API key procurement)
- **Phase 2: Backend Development** (WebSocket server setup, Groq STT & LLM integration, Sarvam AI TTS streaming)
- **Phase 3: Frontend Development** (React UI setup, Web Audio API implementation, VAD logic, Barge-in handling)
- **Phase 4: Sales Logic & AI Tuning** (System prompt engineering for generic sales stages, conversation flow tuning)
- **Phase 5: Integration & Testing** (End-to-end audio streaming, latency optimization, conversational testing)
- **Phase 6: Deployment & Handoff** (Documentation, final review, and code handoff)

---

## 3. Gantt Chart (Detailed Task Scheduling)
The Gantt chart illustrates the baseline schedule for all development tasks, highlighting dependencies and the expected duration for each module.

```mermaid
gantt
    title AI Sales Agent Development Schedule (11 Months)
    dateFormat  YYYY-MM-DD
    axisFormat  %Y-%m
    
    section Phase 1: Setup
    Requirements & Architecture :a1, 2026-07-01, 30d
    API Key & Env Setup        :a2, after a1, 15d
    
    section Phase 2: Backend
    WebSocket Server Setup     :b1, after a2, 20d
    Groq STT & LLM Integration :b2, after b1, 35d
    Sarvam AI TTS Integration  :b3, after b2, 20d
    
    section Phase 3: Frontend
    React UI & Vite Setup      :c1, after a2, 20d
    Web Audio & VAD logic      :c2, after c1, 40d
    Barge-in Implementation    :c3, after c2, 30d
    
    section Phase 4: AI Logic
    Sales Prompt Engineering   :d1, after b2, 40d
    Conversation Flow Tuning   :d2, after d1, 35d
    
    section Phase 5: Testing
    End-to-End Integration     :e1, after d2, 50d
    Latency Optimization       :e2, after e1, 40d
    
    section Phase 6: Handoff
    Documentation              :f1, after e2, 30d
    Final Review               :f2, after f1, 15d
```

---

## 4. Timeline Chart (Sequential Milestone Mapping)
The Timeline Chart provides a high-level sequential view of the major project milestones, from the initial kickoff to the final delivery.

```mermaid
timeline
    title Project Milestones: SlipWise (AI Sales Agent) (11 Months)
    2026-07-01 : Project Kickoff & Setup
    2026-08-15 : Phase 1 Complete (Architecture & APIs)
    2026-10-25 : Phase 2 Complete (Backend AI Services)
    2026-11-15 : Phase 3 Complete (Frontend VAD & Audio)
    2027-01-10 : Phase 4 Complete (Sales Logic)
    2027-04-10 : Phase 5 Complete (Integration & Optimization)
    2027-05-25 : Project Handoff & Final Delivery
```

---

## 5. Slip Chart (Variance Analysis)
The Slip Chart is used to track deviations from the baseline schedule by comparing the **Planned Completion** time against the **Actual Completion** time for each milestone. 

*Note: The actual data in this chart simulates a scenario where minor delays occurred during backend development and integration, demonstrating how variance is tracked.*

```mermaid
xychart-beta
    title "Project Milestone Slip Analysis"
    x-axis "Milestones" [Setup, Backend, Frontend, AI Logic, Testing, Handoff]
    y-axis "Months from Start" 0 --> 12
    bar "Planned" [1.5, 3.8, 4.5, 6.3, 9.3, 10.8]
    line "Actual" [1.5, 4.0, 4.8, 6.3, 10.0, 11.2]
```

### Variance Tracking Breakdown
This table accompanies the slip chart to provide a detailed view of schedule deviations and recovery status.

| Milestone | Planned Completion | Actual Completion | Variance (Slip) | Status/Notes |
| :--- | :--- | :--- | :--- | :--- |
| **M1: Setup Complete** | Month 1.5 | Month 1.5 | 0 Months | On Track |
| **M2: Backend Services**| Month 3.8 | Month 4.0 | +0.2 Months | Delayed (API Rate limits) |
| **M3: Frontend VAD** | Month 4.5 | Month 4.8 | +0.3 Months | Delayed (Audio config complexity) |
| **M4: AI Logic Tuned** | Month 6.3 | Month 6.3 | 0 Months | Schedule Recovered |
| **M5: Integration** | Month 9.3 | Month 10.0 | +0.7 Months | Delayed (Latency issues) |
| **M6: Final Handoff** | Month 10.8 | Month 11.2 | +0.4 Months | Completed Late |

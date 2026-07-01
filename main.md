# Project Planning and Tracking: Generic AI Sales Agent

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
    title AI Sales Agent Development Schedule
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d
    
    section Phase 1: Setup
    Requirements & Architecture :a1, 2026-07-01, 3d
    API Key & Env Setup        :a2, after a1, 1d
    
    section Phase 2: Backend
    WebSocket Server Setup     :b1, after a2, 3d
    Groq STT & LLM Integration :b2, after b1, 4d
    Sarvam AI TTS Integration  :b3, after b2, 3d
    
    section Phase 3: Frontend
    React UI & Vite Setup      :c1, after a2, 2d
    Web Audio & VAD logic      :c2, after c1, 4d
    Barge-in Implementation    :c3, after c2, 3d
    
    section Phase 4: AI Logic
    Sales Prompt Engineering   :d1, after b2, 4d
    Conversation Flow Tuning   :d2, after d1, 3d
    
    section Phase 5: Testing
    End-to-End Integration     :e1, after b3, 4d
    Latency Optimization       :e2, after e1, 3d
    
    section Phase 6: Handoff
    Documentation              :f1, after e2, 2d
    Final Review               :f2, after f1, 1d
```

---

## 4. Timeline Chart (Sequential Milestone Mapping)
The Timeline Chart provides a high-level sequential view of the major project milestones, from the initial kickoff to the final delivery.

```mermaid
timeline
    title Project Milestones: Generic AI Sales Agent
    2026-07-01 : Project Kickoff & Setup
    2026-07-05 : Phase 1 Complete (Architecture & APIs)
    2026-07-10 : Phase 3 Complete (Frontend VAD & Audio)
    2026-07-15 : Phase 2 Complete (Backend AI Services)
    2026-07-19 : Phase 4 Complete (Sales Logic)
    2026-07-26 : Phase 5 Complete (Integration & Optimization)
    2026-07-29 : Project Handoff & Final Delivery
```

---

## 5. Slip Chart (Variance Analysis)
The Slip Chart is used to track deviations from the baseline schedule by comparing the **Planned Completion** time against the **Actual Completion** time for each milestone. 

*Note: The actual data in this chart simulates a scenario where minor delays occurred during audio configuration and latency optimization, demonstrating how variance is tracked.*

```mermaid
xychart-beta
    title Project Milestone Slip Analysis (Planned vs. Actual Days from Start)
    x-axis "Milestones" [Setup, Frontend, Backend, AI Logic, Testing, Handoff]
    y-axis "Days from Project Start" 0 --> 30
    bar "Planned Schedule" [4, 9, 14, 18, 25, 28]
    line "Actual Completion" [4, 10, 15, 18, 27, 29]
```

### Variance Tracking Breakdown
This table accompanies the slip chart to provide a detailed view of schedule deviations and recovery status.

| Milestone | Planned Completion | Actual Completion | Variance (Slip) | Status/Notes |
| :--- | :--- | :--- | :--- | :--- |
| **M1: Setup Complete** | Day 4 | Day 4 | 0 Days | On Track |
| **M2: Frontend VAD** | Day 9 | Day 10 | +1 Day | Delayed (Audio config complexity) |
| **M3: Backend Services**| Day 14 | Day 15 | +1 Day | Delayed (API Rate limits) |
| **M4: AI Logic Tuned** | Day 18 | Day 18 | 0 Days | Schedule Recovered |
| **M5: Integration** | Day 25 | Day 27 | +2 Days | Delayed (Latency issues) |
| **M6: Final Handoff** | Day 28 | Day 29 | +1 Day | Completed Late |

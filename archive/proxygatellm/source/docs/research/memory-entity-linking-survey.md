# Research Survey: Memory Layer & Entity Linking for Jeumpa LLM V2.0

**Date:** June 19, 2026  
**Author:** Agent 2 (BH Doctor)  
**Purpose:** Inform Sprint 1 implementation with latest research

---

## 1. Context Window Tracking & Session Memory

### Key Paper: InfiniteICL (Bowen Cao et al., April 2025)

**arXiv:** 2504.01707  
**Title:** "InfiniteICL: Breaking the Limit of Context Window Size via Long Short-term Memory Transformation"

**Key Insights:**
- Parallels context and parameters in LLMs with short-term and long-term memory
- Enables infinite context through memory transformation mechanism
- Could inform our context_sessions table design with automatic LTM transfer

**Implementation Relevance:**
- Our context_messages table should support automatic archival to LTM
- Consider adding memory_type column: 'stm' (active session) vs 'ltm' (archived)
- Implement sliding window for STM, compression for LTM

---

## 2. Long-Term Memory Evaluation

### Key Paper: MemTrace (Xianxuan Long et al., June 2026)

**arXiv:** 2606.17328  
**Title:** "MemTrace: Probing What Final Accuracy Misses in Long-Term Memory"

**Key Insights:**
- Current LLM memory evaluation aggregates accuracy over questions, missing fact-level consistency
- Proposes fact-level probing across sessions
- Shows that independent question scoring hides memory inconsistencies

**Implementation Relevance:**
- Our session_entities bridge table should track mention frequency and temporal patterns
- Add consistency checks: same fact across sessions should have same entity ID
- Implement fact-level retrieval benchmarks, not just question-answer accuracy

---

## 3. Knowledge Graph Construction

### Key Paper: AI Agent-Driven Framework (Dimitar Peshevski et al., Nov 2025)

**arXiv:** 2511.11017  
**Title:** "AI Agent-Driven Framework for Automated Product Knowledge Graph Construction in E-Commerce"

**Key Insights:**
- Automated KG construction from unstructured product data
- Uses entity extraction + relation inference pipeline
- Achieves structured format for recommendation systems

**Implementation Relevance:**
- Our graph_entities + graph_relations schema aligns with this approach
- Consider adding confidence scores to extracted entities
- Implement relation type hierarchy (e.g., related_to, part_of, instance_of)

---

## Implementation Recommendations for Sprint 1

### Schema Enhancements

1. **Memory Mode Switching** (InfiniteICL): Support multiple memory strategies
2. **Fact-Level Tracking** (MemTrace): Enable consistency checks across sessions
3. **State Checkpoints**: Store computation state, not just tokens
4. **Confidence Scoring**: Track extraction quality
5. **Correction Tracking**: Learn from user corrections

---

## References

- Cao, B., et al. (2025). InfiniteICL. arXiv:2504.01707
- Long, X., et al. (2026). MemTrace. arXiv:2606.17328
- Peshevski, D., et al. (2025). AI Agent-Driven KG Construction. arXiv:2511.11017
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('Project Workbench locale contract', () => {
  it('keeps the English and Chinese Review/Activity dictionaries exactly aligned', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const [key, value] of Object.entries(zh)) {
      expect(value, `missing Chinese copy for ${key}`).not.toBe('')
      expect(en[key as keyof typeof en], `missing English copy for ${key}`).not.toBe('')
    }
  })

  it('stabilizes real-browser accessible names and textual status/risk vocabulary', () => {
    expect(zh['review.title']).toBe('Review Center')
    expect(zh['review.filters.status.label']).toBe('建议状态')
    expect(zh['review.filters.risk.label']).toBe('风险等级')
    expect(zh['review.proposal.accountable']).toBe('提案 Accountable')
    expect(zh['review.proposal.contributors']).toBe('提案 Contributors')
    expect(zh['review.proposal.sponsor']).toBe('提案 Human Sponsor')
    expect(zh['review.proposal.evidence']).toBe('提案 Evidence')
    expect(zh['review.decision.feedback']).toBe('反馈原因')
    expect([
      zh['review.filter.status.pending'],
      zh['review.filter.status.accepted'],
      zh['review.filter.status.rejected'],
      zh['review.filter.status.deferred'],
      zh['review.filter.status.stale'],
    ]).toEqual(['待处理', '已接受', '已拒绝', '已延期', '已过期'])
    expect([
      zh['review.risk.low'],
      zh['review.risk.high'],
    ]).toEqual(['低风险', '高风险'])
  })

  it('stabilizes bilingual workflow review and explicit-completion copy', () => {
    expect([
      zh['tasks.workflow.preview'],
      zh['tasks.workflow.completionSuggested'],
      zh['tasks.workflow.confirmCompletion'],
    ]).toEqual(['预览兼容性', '建议完成', '确认完成任务'])
    expect([
      en['tasks.workflow.preview'],
      en['tasks.workflow.completionSuggested'],
      en['tasks.workflow.confirmCompletion'],
    ]).toEqual([
      'Preview compatibility',
      'Completion suggested',
      'Confirm task completion',
    ])
  })
})

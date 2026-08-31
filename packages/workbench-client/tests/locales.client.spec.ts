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

  it('stabilizes bilingual Project Calendar and Milestone Activity vocabulary', () => {
    expect([
      zh['activity.object.projectCalendarBinding'],
      zh['activity.object.projectMilestone'],
      zh['activity.action.projectCalendarBound'],
      zh['activity.action.projectMilestoneCreated'],
      zh['activity.action.projectMilestoneDateUpdateRequested'],
      zh['activity.summary.projectCalendarBound'],
      zh['activity.summary.projectMilestoneCreated'],
      zh['activity.summary.projectMilestoneDateUpdateRequested'],
      zh['activity.reason.ownerProjectCalendarBind'],
      zh['activity.reason.ownerProjectMilestoneCreate'],
      zh['activity.reason.ownerProjectMilestoneDateUpdate'],
    ]).toEqual([
      'Project 日历绑定',
      'Project Milestone',
      'Project 日历已绑定',
      'Project Milestone 已创建',
      '已请求更新 Project Milestone 日期',
      '已绑定 Project 权威日历',
      '已创建 Project Milestone',
      '已请求更新 Project Milestone 权威日期',
      'Owner 绑定 Project 日历',
      'Owner 创建 Project Milestone',
      'Owner 更新 Project Milestone 日期',
    ])
    expect([
      en['activity.object.projectCalendarBinding'],
      en['activity.object.projectMilestone'],
      en['activity.action.projectCalendarBound'],
      en['activity.action.projectMilestoneCreated'],
      en['activity.action.projectMilestoneDateUpdateRequested'],
    ]).toEqual([
      'Project calendar binding',
      'Project Milestone',
      'Project calendar bound',
      'Project Milestone created',
      'Project Milestone date update requested',
    ])
  })
})

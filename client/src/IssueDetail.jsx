import React, { useEffect, useState, useRef } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'
import {
  getIssueDetail, getComments, postComment,
  getCollaborators, getRepoLabels,
  updateAssignees, updateLabels,
} from './api'

// Configure marked
marked.setOptions({ breaks: true, gfm: true })

// Init mermaid once
mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })

// Render markdown string → HTML, then replace mermaid fences with rendered SVG
function MarkdownBody({ source }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    // Render mermaid code blocks
    const mermaidNodes = ref.current.querySelectorAll('.mermaid')
    mermaidNodes.forEach((node, i) => {
      const code = node.textContent
      node.innerHTML = ''
      mermaid.render(`mermaid-${Date.now()}-${i}`, code).then(({ svg }) => {
        node.innerHTML = svg
      }).catch(err => {
        node.textContent = `Mermaid error: ${err.message}`
        node.style.color = 'red'
      })
    })
  }, [source])

  // Pre-process: wrap ```mermaid blocks with class="mermaid" div
  const processed = source
    ? source.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) =>
        `<div class="mermaid">${code}</div>`
      )
    : ''

  const html = marked.parse(processed)
  return <div ref={ref} className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
}

const KANBAN_LABELS = ['kanban:todo', 'kanban:in-progress', 'kanban:done']

export default function IssueDetail({ issueId, onClose, onMoved }) {
  const [issue, setIssue] = useState(null)
  const [comments, setComments] = useState([])
  const [collaborators, setCollaborators] = useState([])
  const [repoLabels, setRepoLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [commentDraft, setCommentDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [activeTab, setActiveTab] = useState('detail') // detail | comments

  useEffect(() => {
    if (!issueId) return
    setLoading(true)
    Promise.all([
      getIssueDetail(issueId),
      getComments(issueId),
      getCollaborators(),
      getRepoLabels(),
    ]).then(([iss, cmts, colabs, labels]) => {
      setIssue(iss)
      setComments(cmts)
      setCollaborators(colabs)
      setRepoLabels(labels.filter(l => !KANBAN_LABELS.includes(l.name)))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [issueId])

  const handlePostComment = async () => {
    if (!commentDraft.trim()) return
    setPosting(true)
    try {
      const c = await postComment(issueId, commentDraft)
      setComments(prev => [...prev, c])
      setCommentDraft('')
    } finally { setPosting(false) }
  }

  const handleToggleAssignee = async (login) => {
    const current = issue.assignees.map(a => a.login)
    const next = current.includes(login)
      ? current.filter(l => l !== login)
      : [...current, login]
    const updated = await updateAssignees(issueId, next)
    setIssue(updated)
  }

  const handleToggleLabel = async (labelName) => {
    const current = issue.labels.map(l => l.name)
    const next = current.includes(labelName)
      ? current.filter(n => n !== labelName)
      : [...current, labelName]
    const updated = await updateLabels(issueId, next)
    setIssue(updated)
  }

  if (!issueId) return null

  return (
    <div className="detail-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="detail-panel">
        {/* Header */}
        <div className="detail-header">
          <div className="detail-header__left">
            <span className="detail-number">#{issueId}</span>
            {issue && (
              <a href={issue.html_url} target="_blank" rel="noreferrer" className="detail-gh-link">
                View on GitHub ↗
              </a>
            )}
          </div>
          <button className="detail-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="detail-loading">Loading issue…</div>
        ) : !issue ? (
          <div className="detail-loading">Failed to load issue.</div>
        ) : (
          <>
            <h2 className="detail-title">{issue.title}</h2>

            {/* Tabs */}
            <div className="detail-tabs">
              {['detail', 'comments'].map(t => (
                <button
                  key={t}
                  className={`detail-tab${activeTab === t ? ' detail-tab--active' : ''}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t === 'detail' ? '📄 Detail' : `💬 Comments (${comments.length})`}
                </button>
              ))}
            </div>

            {activeTab === 'detail' && (
              <div className="detail-body">
                {/* Description */}
                <section className="detail-section">
                  <h3 className="detail-section__title">Description</h3>
                  {issue.body
                    ? <MarkdownBody source={issue.body} />
                    : <p className="detail-empty">No description provided.</p>
                  }
                </section>

                {/* Assignees */}
                <section className="detail-section">
                  <h3 className="detail-section__title">Assignees</h3>
                  <div className="detail-assignees">
                    {issue.assignees.map(a => (
                      <span key={a.login} className="assignee-tag">
                        <img src={a.avatar_url} alt={a.login} className="assignee-avatar" />
                        {a.login}
                        <button onClick={() => handleToggleAssignee(a.login)} title="Remove">×</button>
                      </span>
                    ))}
                    {collaborators.filter(c => !issue.assignees.find(a => a.login === c.login)).map(c => (
                      <button key={c.login} className="assignee-add" onClick={() => handleToggleAssignee(c.login)}>
                        <img src={c.avatar_url} alt={c.login} className="assignee-avatar" />
                        + {c.login}
                      </button>
                    ))}
                    {collaborators.length === 0 && issue.assignees.length === 0 && (
                      <span className="detail-empty">No collaborators found.</span>
                    )}
                  </div>
                </section>

                {/* Labels */}
                <section className="detail-section">
                  <h3 className="detail-section__title">Labels</h3>
                  <div className="detail-labels">
                    {issue.labels.filter(l => !KANBAN_LABELS.includes(l.name)).map(l => (
                      <span
                        key={l.name}
                        className="label-tag"
                        style={{ background: `#${l.color}22`, borderColor: `#${l.color}`, color: `#${l.color}` }}
                        onClick={() => handleToggleLabel(l.name)}
                        title="Click to remove"
                      >
                        {l.name} ×
                      </span>
                    ))}
                    {repoLabels.filter(l => !issue.labels.find(il => il.name === l.name)).map(l => (
                      <span
                        key={l.name}
                        className="label-tag label-tag--add"
                        style={{ borderColor: `#${l.color}66` }}
                        onClick={() => handleToggleLabel(l.name)}
                        title="Click to add"
                      >
                        + {l.name}
                      </span>
                    ))}
                  </div>
                </section>

                {/* Kanban column indicator */}
                <section className="detail-section">
                  <h3 className="detail-section__title">Column</h3>
                  <div className="detail-labels">
                    {issue.labels.filter(l => KANBAN_LABELS.includes(l.name)).map(l => (
                      <span key={l.name} className="label-tag label-tag--kanban">{l.name}</span>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="detail-comments">
                {comments.length === 0 && (
                  <p className="detail-empty">No comments yet.</p>
                )}
                {comments.map(c => (
                  <div key={c.id} className="comment">
                    <div className="comment__header">
                      <img src={c.user.avatar_url} alt={c.user.login} className="assignee-avatar" />
                      <strong>{c.user.login}</strong>
                      <span className="comment__time">{new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <MarkdownBody source={c.body} />
                  </div>
                ))}

                {/* New comment */}
                <div className="comment-compose">
                  <textarea
                    className="comment-compose__input"
                    placeholder="Leave a comment… (Markdown supported)"
                    value={commentDraft}
                    onChange={e => setCommentDraft(e.target.value)}
                    rows={4}
                  />
                  <button
                    className="btn btn--primary"
                    onClick={handlePostComment}
                    disabled={posting || !commentDraft.trim()}
                  >
                    {posting ? 'Posting…' : 'Comment'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

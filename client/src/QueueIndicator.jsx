import React from 'react'

/**
 * Shows a small sync status pill in the board meta bar.
 * Events from SSE:
 *   queue_update: { job: { status, operation } }
 *   queue_error:  { job: { error, retryIn } }
 */
export default function QueueIndicator({ pending, lastError, lastOp }) {
  if (lastError) {
    return (
      <span className="queue-indicator queue-indicator--error" title={lastError}>
        ⚠ Sync error (retrying…)
      </span>
    )
  }
  if (pending > 0) {
    return (
      <span className="queue-indicator queue-indicator--syncing">
        <span className="queue-dot" />
        Syncing to GitHub ({pending} pending)
      </span>
    )
  }
  if (lastOp) {
    return (
      <span className="queue-indicator queue-indicator--done">
        ✓ Synced
      </span>
    )
  }
  return null
}

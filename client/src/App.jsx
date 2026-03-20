import React, { useEffect, useState } from 'react'
import Board from './Board'

export default function App() {
  const [config, setConfig] = useState(null)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => {})
  }, [])

  return (
    <div className="app">
      <header className="app__header">
        <h1>🗂 Kanban Board</h1>
        {config && (
          <a
            href={`https://github.com/${config.owner}/${config.repo}/issues`}
            target="_blank"
            rel="noreferrer"
            className="app__repo-link"
          >
            {config.owner}/{config.repo} ↗
          </a>
        )}
      </header>
      <main>
        <Board />
      </main>
    </div>
  )
}

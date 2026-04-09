import React from 'react'

export default function ViewSwitcher({ view, onSwitch }) {
  return (
    <div className="view-switcher">
      <button
        className={`view-switcher__btn ${view === 'kanban' ? 'view-switcher__btn--active' : ''}`}
        onClick={() => onSwitch('kanban')}
      >
        Kanban
      </button>
      <button
        className={`view-switcher__btn ${view === 'gantt' ? 'view-switcher__btn--active' : ''}`}
        onClick={() => onSwitch('gantt')}
      >
        Gantt
      </button>
    </div>
  )
}

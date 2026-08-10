import { createContext, useContext, useState, useEffect, useCallback } from 'react';

/* ──────────── localStorage key ──────────── */

const SCHEDULE_KEY = 'testing-ui-schedule-tasks';

/* ──────────── helpers ──────────── */

function loadTasks() {
  try {
    const saved = localStorage.getItem(SCHEDULE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

/* ──────────── context ──────────── */

const ScheduleContext = createContext(null);

export function ScheduleProvider({ children }) {
  const [tasks, setTasks] = useState(loadTasks);

  /* persist every change */
  useEffect(() => {
    try {
      localStorage.setItem(SCHEDULE_KEY, JSON.stringify(tasks));
    } catch {
      /* quota exceeded */
    }
  }, [tasks]);

  const addTask = useCallback((task) => {
    setTasks((prev) => [task, ...prev]);
  }, []);

  const updateTask = useCallback((id, updates) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  const removeTask = useCallback((id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearTasks = useCallback(() => {
    setTasks([]);
  }, []);

  return (
    <ScheduleContext.Provider
      value={{ tasks, addTask, updateTask, removeTask, clearTasks }}
    >
      {children}
    </ScheduleContext.Provider>
  );
}

/* ──────────── guard hook ──────────── */

export function useSchedule() {
  const ctx = useContext(ScheduleContext);
  if (!ctx) {
    throw new Error('useSchedule must be used within <ScheduleProvider>');
  }
  return ctx;
}

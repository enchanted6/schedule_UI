/**
 * Schedule — bottom panel: live Windows Task Scheduler rows (TestPlatform_*).
 */

export default function ScheduleRegisteredTasks({
  tasks = [],
  loading,
  error,
  onRefresh,
}) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card p-5 shadow-sm dark:border-border-dark dark:bg-card-dark">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <i className="fa fa-windows text-primary" />
          Registered Tasks
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-text-secondary dark:bg-gray-800">
            {tasks.length}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-secondary">
            Windows Task Scheduler (TestPlatform_*)
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="btn-secondary flex items-center gap-1.5 px-2.5 py-1 text-xs disabled:opacity-50"
          >
            <i className={`fa fa-refresh ${loading ? 'fa-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 shrink-0 rounded border border-danger/40 bg-red-50 px-3 py-2 text-xs text-danger dark:bg-red-950/30">
          <i className="fa fa-exclamation-circle mr-1" />
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-card dark:bg-card-dark">
            <tr className="border-b border-border text-text-secondary dark:border-border-dark">
              <th className="px-2 py-1.5 font-medium">Task Name</th>
              <th className="px-2 py-1.5 font-medium">State</th>
              <th className="px-2 py-1.5 font-medium">Next Run</th>
              <th className="px-2 py-1.5 font-medium">Last Run</th>
              <th className="px-2 py-1.5 font-medium">Last Result</th>
            </tr>
          </thead>
          {tasks.length > 0 && (
            <tbody>
              {tasks.map((row) => (
                <tr
                  key={`${row.taskPath || ''}${row.taskName}`}
                  className="border-b border-border/60 dark:border-border-dark/60"
                >
                  <td
                    className="max-w-[20rem] truncate px-2 py-2 font-mono text-[11px]"
                    title={row.taskName}
                  >
                    {row.taskName}
                  </td>
                  <td className="px-2 py-2">
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-primary dark:bg-blue-950/40">
                      {row.state || '—'}
                    </span>
                  </td>
                  <td className="px-2 py-2 tabular-nums text-text-secondary">
                    {row.nextRunTime || '—'}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-text-secondary">
                    {row.lastRunTime || '—'}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-text-secondary">
                    {row.lastResult == null ? '—' : String(row.lastResult)}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>

        {!loading && !error && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-text-secondary">
            <i className="fa fa-calendar-o text-3xl opacity-30" />
            <p className="mt-2 text-sm">No TestPlatform_* tasks in Windows Task Scheduler.</p>
            <p className="mt-1 text-xs">Register above, then click Refresh.</p>
          </div>
        )}

        {loading && tasks.length === 0 && !error && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-secondary">
            <i className="fa fa-spinner fa-spin" />
            Querying Windows Task Scheduler…
          </div>
        )}
      </div>
    </section>
  );
}

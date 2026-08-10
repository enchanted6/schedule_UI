/**
 * Schedule — right Tags panel (grouped catalog + per-row exchanges).
 *
 * When activeCategory is set: that group is highlighted & interactive;
 * other groups stay visible but dimmed / not clickable.
 * When activeCategory is empty (All): every group is interactive.
 */

import {
  getSelectionExchanges,
  isTagSelected,
} from '../../utils/scheduler';

function TagRow({
  task,
  selection,
  tagError,
  registering,
  interactive,
  onToggleTag,
  onToggleExchange,
  onSelectAllExchanges,
}) {
  const enabled = isTagSelected(selection, task);
  const picked = enabled ? getSelectionExchanges(selection[task.tag]) : [];
  const allOn =
    enabled &&
    task.exchanges.length > 0 &&
    task.exchanges.every((ex) => picked.includes(ex));
  const missingEx = enabled && picked.length === 0;
  const canClick = interactive && !registering;

  return (
    <div
      className={`rounded-md border px-2.5 py-1.5 transition-colors ${
        missingEx || tagError === task.tag
          ? 'border-danger bg-red-50/60 dark:bg-red-950/25'
          : !interactive
            ? 'border-border/60 bg-gray-100/80 opacity-50 dark:border-border-dark dark:bg-gray-800/40'
            : enabled
              ? 'border-primary/50 bg-blue-100 shadow-sm dark:border-primary/40 dark:bg-blue-900/40'
              : 'border-blue-200 bg-blue-50 dark:border-blue-800/60 dark:bg-blue-950/30'
      }`}
    >
      <div className="grid items-center gap-x-3 gap-y-1.5 [grid-template-columns:minmax(11rem,16rem)_4.75rem_3.25rem_minmax(0,1fr)_2.75rem]">
        <button
          type="button"
          disabled={!canClick}
          title={
            !interactive
              ? 'Other category is active'
              : enabled
                ? 'Click to deselect tag'
                : 'Click to select tag'
          }
          onClick={() => onToggleTag(task)}
          className={`min-w-0 truncate text-left font-mono text-xs disabled:cursor-not-allowed ${
            enabled
              ? 'font-semibold text-primary underline decoration-primary/40 underline-offset-2'
              : interactive
                ? 'text-text-primary hover:text-primary dark:text-text-primary-dark'
                : 'text-text-secondary'
          }`}
        >
          {task.tag}
        </button>
        <span className="shrink-0 font-mono text-[11px] tabular-nums tracking-tight text-text-secondary">
          {task.registerTime}
        </span>
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums text-text-secondary"
          title={task.parallel ? `parallel=${task.parallel}` : 'no parallel'}
        >
          {task.parallel ? `p=${task.parallel}` : '—'}
        </span>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {task.exchanges.map((ex) => {
            const on = enabled && picked.includes(ex);
            return (
              <button
                key={ex}
                type="button"
                disabled={!canClick}
                onClick={() => onToggleExchange(task, ex)}
                className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors disabled:cursor-not-allowed ${
                  on
                    ? 'border-primary bg-primary text-white'
                    : interactive
                      ? 'border-primary/40 bg-white text-text-primary hover:border-primary hover:bg-blue-50 dark:bg-surface-dark dark:text-text-primary-dark dark:hover:bg-blue-950/40'
                      : 'border-border/70 bg-gray-50 text-text-secondary dark:border-border-dark dark:bg-surface-dark/40'
                }`}
              >
                {ex}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={!canClick || !enabled}
          onClick={() => onSelectAllExchanges(task)}
          className="justify-self-end text-[11px] text-primary hover:underline disabled:opacity-40"
        >
          {allOn ? 'Clear' : 'All'}
        </button>
      </div>
      {missingEx && interactive && (
        <p className="mt-1 text-[11px] text-danger">
          Select at least one exchange.
        </p>
      )}
    </div>
  );
}

export default function ScheduleTagCatalog({
  category,
  catalogGroups,
  selection,
  tagError,
  registering,
  onlyShowActive,
  onOnlyShowActiveChange,
  onToggleTag,
  onToggleExchange,
  onSelectAllExchanges,
}) {
  const empty = catalogGroups.length === 0;
  const locked = Boolean(category);

  return (
    <section className="flex h-full min-h-[280px] flex-col rounded-lg border border-border bg-card p-5 shadow-sm dark:border-border-dark dark:bg-card-dark">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <i className="fa fa-tags text-primary" />
          Tags
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-normal text-primary dark:bg-blue-950/40">
            {category || 'All categories'}
          </span>
        </h3>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-secondary select-none"
          title={
            onlyShowActive
              ? 'Checked: only the active category is listed'
              : 'Unchecked: list all categories; inactive ones are dimmed'
          }
        >
          <input
            type="checkbox"
            className="rounded border-border"
            checked={onlyShowActive}
            disabled={registering}
            onChange={(e) => onOnlyShowActiveChange?.(e.target.checked)}
          />
          只显示选中
        </label>
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-text-secondary">
          <i className="fa fa-inbox text-2xl opacity-40" />
          <p className="mt-2 text-sm">No tags in catalog.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-auto">
          {catalogGroups.map((group) => {
            const interactive = !locked || group.categoryTag === category;
            return (
              <div
                key={group.categoryTag}
                className={`rounded-lg p-2 transition-colors ${
                  locked && interactive
                    ? 'bg-blue-50/80 ring-1 ring-primary/25 dark:bg-blue-950/25 dark:ring-primary/30'
                    : locked && !interactive
                      ? 'bg-gray-50/50 dark:bg-gray-900/20'
                      : ''
                }`}
              >
                <h4
                  className={`mb-2 flex items-center gap-2 text-xs font-semibold ${
                    interactive
                      ? 'text-text-secondary'
                      : 'text-text-secondary/70'
                  }`}
                >
                  <i className="fa fa-folder-o" />
                  <span
                    className={`font-mono ${
                      locked && interactive
                        ? 'font-bold text-primary'
                        : 'text-text-primary dark:text-text-primary-dark'
                    }`}
                  >
                    {group.categoryTag}
                  </span>
                  <span className="font-normal">({group.tasks.length})</span>
                  {locked && interactive && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                      active
                    </span>
                  )}
                </h4>
                <div className="space-y-1.5">
                  {group.tasks.map((task) => (
                    <TagRow
                      key={`${task.categoryTag}/${task.tag}`}
                      task={task}
                      selection={selection}
                      tagError={tagError}
                      registering={registering}
                      interactive={interactive}
                      onToggleTag={onToggleTag}
                      onToggleExchange={onToggleExchange}
                      onSelectAllExchanges={onSelectAllExchanges}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Schedule — left Setup panel (env, category filter, will-register summary, actions).
 */

import {
  ENV_OPTIONS,
  labelCls,
  selectCls,
} from '../../utils/scheduler';

export default function ScheduleSetup({
  form,
  fieldErrors,
  setField,
  categories,
  catalogLoading,
  catalogError,
  onReloadCatalog,
  onRegister,
  onReset,
  registering,
  scopeText,
  willTaskCount,
}) {
  return (
    <section className="h-full overflow-auto rounded-lg border border-border bg-card p-5 shadow-sm dark:border-border-dark dark:bg-card-dark">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <i className="fa fa-edit text-primary" />
          Setup
        </h3>
        <button
          type="button"
          onClick={onReloadCatalog}
          disabled={catalogLoading || registering}
          className="btn-secondary flex items-center gap-1.5 px-2.5 py-1 text-xs disabled:opacity-50"
          title="Catalog also auto-refreshes every 2s from Register-SchedularTask.ps1 -mode list"
        >
          <i className={`fa fa-refresh ${catalogLoading ? 'fa-spin' : ''}`} />
          Reload now
        </button>
      </div>

      {catalogError && (
        <div className="mb-3 rounded border border-danger/40 bg-red-50 px-3 py-2 text-xs text-danger dark:bg-red-950/30">
          <i className="fa fa-exclamation-circle mr-1" />
          {catalogError}
        </div>
      )}

      {catalogLoading && categories.length === 0 && !catalogError && (
        <div className="mb-3 flex items-center gap-2 text-xs text-text-secondary">
          <i className="fa fa-spinner fa-spin" />
          Loading catalog…
        </div>
      )}

      <div className="space-y-3">
        <label className="block">
          <span className={labelCls}>
            env <span className="text-danger">*</span>
          </span>
          <select
            className={`${selectCls}${fieldErrors?.env ? ' border-danger' : ''}`}
            value={form.env}
            disabled={registering}
            onChange={(e) => setField('env', e.target.value)}
          >
            <option value="" disabled hidden>
              Choose env…
            </option>
            {ENV_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelCls}>Category</span>
          <select
            className={selectCls}
            value={form.category}
            disabled={registering || categories.length === 0}
            onChange={(e) => setField('category', e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-text-secondary">
            Pick one here → that group is highlighted on the right; others stay listed but grayed out.
          </span>
        </label>

        <div className="rounded border border-border bg-surface px-3 py-2 dark:border-border-dark dark:bg-surface-dark">
          <p className="text-[11px] text-text-secondary">Will register</p>
          <p className="mt-0.5 text-xs">
            {willTaskCount > 0
              ? `${willTaskCount} Windows task(s)`
              : form.category
                ? 'Category selected — Register uses all tags/exchanges by default'
                : 'Pick a Category, or tags/exchanges on the right'}
          </p>
          {scopeText ? (
            <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-text-secondary">
              {scopeText}
            </pre>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRegister}
          disabled={registering}
          className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <i className={`fa ${registering ? 'fa-spinner fa-spin' : 'fa-calendar-plus'}`} />
          {registering ? 'Registering…' : 'Register Task'}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={registering}
          className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <i className="fa fa-undo" />
          Reset
        </button>
      </div>
    </section>
  );
}

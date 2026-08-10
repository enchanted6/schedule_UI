/**
 * Schedule page — shared constants and pure helpers.
 */

export const LEFT_WIDTH_DEFAULT = 380;
export const LEFT_WIDTH_MIN = 280;
export const VIEWER_WIDTH_MIN = 320;
export const SPLITTER_WIDTH = 10;

export const TOP_HEIGHT_DEFAULT = 420;
export const TOP_HEIGHT_MIN = 220;
export const BOTTOM_HEIGHT_MIN = 160;
export const SPLITTER_HEIGHT = 10;

/** Poll Register-SchedularTask.ps1 -mode list */
export const CATALOG_POLL_MS = 2000;

export const ENV_OPTIONS = ['dev', 'qa_bk', 'qa', 'test'];

export const EMPTY_FORM = {
  env: '',
  category: '',
};

export const TOAST_ICON = {
  success: 'fa-check-circle',
  error: 'fa-exclamation-circle',
  warning: 'fa-exclamation-triangle',
  info: 'fa-info-circle',
};

export const TOAST_BG = {
  success: 'bg-success',
  error: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-primary',
};

export const inputCls =
  'w-full rounded border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary transition-colors focus:border-primary focus:outline-none dark:border-border-dark dark:bg-surface-dark dark:text-text-primary-dark';

export const labelCls = 'mb-0.5 block text-xs font-medium text-text-secondary';

export const selectCls = `${inputCls} appearance-none cursor-pointer`;

/**
 * selection entry shape: { categoryTag, exchanges: string[] }
 * (legacy array-only values still accepted)
 */
export function getSelectionExchanges(entry) {
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  return Array.isArray(entry.exchanges) ? entry.exchanges : [];
}

export function getSelectionCategory(entry) {
  if (!entry || Array.isArray(entry)) return '';
  return String(entry.categoryTag || '');
}

/** Whether this catalog row is the active selection for its tag. */
export function isTagSelected(selection, task) {
  const entry = selection[task.tag];
  if (!entry) return false;
  const cat = getSelectionCategory(entry);
  // legacy array entries: treat as selected (category resolved elsewhere)
  if (!cat) return true;
  return cat === task.categoryTag;
}

/** selection → scope string for PS1 */
export function buildScopeFromSelection(selection) {
  const parts = [];
  for (const [tag, entry] of Object.entries(selection)) {
    const exs = getSelectionExchanges(entry);
    if (exs.length === 0) continue;
    parts.push(`${tag}:${exs.join(',')}`);
  }
  return parts.join('/');
}

/** Single categoryTag implied by current selection ('' if none / ambiguous). */
export function resolveSelectionCategory(selection) {
  const cats = new Set();
  for (const entry of Object.values(selection)) {
    const cat = getSelectionCategory(entry);
    if (cat) cats.add(cat);
  }
  if (cats.size === 1) return [...cats][0];
  return '';
}

/** Unique categoryTag values from catalog tasks. */
export function uniqueCategories(catalog) {
  return [...new Set(catalog.map((t) => t.categoryTag))];
}

/**
 * Groups for the tag panel.
 * @param {Array} catalog
 * @param {string} categoryFilter empty = all categories
 */
export function groupCatalog(catalog, categoryFilter) {
  const cats = categoryFilter
    ? [categoryFilter]
    : uniqueCategories(catalog);
  return cats
    .map((categoryTag) => ({
      categoryTag,
      tasks: catalog.filter((t) => t.categoryTag === categoryTag),
    }))
    .filter((g) => g.tasks.length > 0);
}

/** Rows that will become Windows tasks (tag × selected exchanges). */
export function buildWillRegisterRows(catalog, selection, categoryFilter) {
  const rows = [];
  for (const task of catalog) {
    if (!isTagSelected(selection, task)) continue;
    if (categoryFilter && task.categoryTag !== categoryFilter) continue;
    const exs = getSelectionExchanges(selection[task.tag]);
    if (exs.length === 0) continue;
    rows.push({
      categoryTag: task.categoryTag,
      tag: task.tag,
      registerTime: task.registerTime,
      parallel: task.parallel,
      exchanges: exs,
    });
  }
  return rows;
}

export function countWillTasks(rows) {
  return rows.reduce((n, r) => n + r.exchanges.length, 0);
}

/** Drop selection entries that disappeared from catalog; keep valid picks. */
export function pruneSelection(selection, catalog) {
  const next = {};
  for (const [tag, entry] of Object.entries(selection)) {
    const cat = getSelectionCategory(entry);
    const task = catalog.find(
      (t) => t.tag === tag && (!cat || t.categoryTag === cat),
    );
    if (!task) continue;
    const allowed = new Set(task.exchanges);
    const exs = getSelectionExchanges(entry).filter((ex) => allowed.has(ex));
    next[tag] = {
      categoryTag: cat || task.categoryTag,
      exchanges: exs,
    };
  }
  return next;
}

export function catalogFingerprint(tasks) {
  return JSON.stringify(tasks);
}

/** Remove tags that have zero exchanges selected. */
export function pruneEmptySelection(selection) {
  const next = {};
  for (const [tag, entry] of Object.entries(selection)) {
    const exs = getSelectionExchanges(entry);
    if (exs.length === 0) continue;
    next[tag] = {
      categoryTag: getSelectionCategory(entry),
      exchanges: exs,
    };
  }
  return next;
}

export function selectionHasPicks(selection) {
  return Object.keys(pruneEmptySelection(selection)).length > 0;
}

/** Windows task count if registering whole category (empty scope). */
export function countCategoryTasks(catalog, categoryTag) {
  if (!categoryTag) return 0;
  return catalog
    .filter((t) => t.categoryTag === categoryTag)
    .reduce((n, t) => n + (t.exchanges?.length || 0), 0);
}

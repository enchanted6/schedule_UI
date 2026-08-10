/**
 * Schedule — page bus: state, IPC, splitters, toast; injects three panels.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ScheduleSetup from '../components/schedule/ScheduleSetup';
import ScheduleTagCatalog from '../components/schedule/ScheduleTagCatalog';
import ScheduleRegisteredTasks from '../components/schedule/ScheduleRegisteredTasks';
import {
  BOTTOM_HEIGHT_MIN,
  CATALOG_POLL_MS,
  EMPTY_FORM,
  LEFT_WIDTH_DEFAULT,
  LEFT_WIDTH_MIN,
  SPLITTER_HEIGHT,
  SPLITTER_WIDTH,
  TOAST_BG,
  TOAST_ICON,
  TOP_HEIGHT_DEFAULT,
  TOP_HEIGHT_MIN,
  VIEWER_WIDTH_MIN,
  buildScopeFromSelection,
  buildWillRegisterRows,
  catalogFingerprint,
  countCategoryTasks,
  countWillTasks,
  getSelectionCategory,
  getSelectionExchanges,
  groupCatalog,
  isTagSelected,
  pruneEmptySelection,
  pruneSelection,
  resolveSelectionCategory,
  selectionHasPicks,
  uniqueCategories,
} from '../utils/scheduler';

export default function SchedulePage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [selection, setSelection] = useState({});
  const [tagError, setTagError] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [toast, setToast] = useState(null);
  const [leftWidth, setLeftWidth] = useState(LEFT_WIDTH_DEFAULT);
  const leftWidthRef = useRef(LEFT_WIDTH_DEFAULT);
  const colSplitRef = useRef(null);
  const [topHeight, setTopHeight] = useState(TOP_HEIGHT_DEFAULT);
  const topHeightRef = useRef(TOP_HEIGHT_DEFAULT);
  const rowSplitRef = useRef(null);
  const [winTasks, setWinTasks] = useState([]);
  const [winLoading, setWinLoading] = useState(false);
  const [winError, setWinError] = useState('');
  const [registering, setRegistering] = useState(false);
  /** true = only list the locked category; false = show all, dim inactive */
  const [onlyShowActive, setOnlyShowActive] = useState(false);
  const catalogInFlightRef = useRef(false);
  const catalogFpRef = useRef('');

  leftWidthRef.current = leftWidth;
  topHeightRef.current = topHeight;

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshWinTasks = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.listWinSchedulerTasks) {
      setWinError('Scheduler API unavailable — use npm run electron:dev.');
      setWinTasks([]);
      return;
    }
    setWinLoading(true);
    setWinError('');
    try {
      const res = await api.listWinSchedulerTasks();
      if (!res?.ok) {
        setWinError(res?.error || 'Failed to query Windows Task Scheduler.');
        setWinTasks([]);
        return;
      }
      setWinTasks(Array.isArray(res.data?.tasks) ? res.data.tasks : []);
    } catch (err) {
      setWinError(err.message || 'Failed to query Windows Task Scheduler.');
      setWinTasks([]);
    } finally {
      setWinLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async ({ silent = false } = {}) => {
    const api = window.electronAPI;
    if (!api?.listSchedulerTasks) {
      if (!silent) {
        setCatalogError('Scheduler API unavailable — use npm run electron:dev.');
        setCatalog([]);
      }
      return;
    }
    if (catalogInFlightRef.current) return;
    catalogInFlightRef.current = true;
    if (!silent) {
      setCatalogLoading(true);
      setCatalogError('');
    }
    try {
      const res = await api.listSchedulerTasks();
      if (!res?.ok) {
        if (!silent) {
          setCatalogError(res?.error || 'Failed to load catalog.');
          setCatalog([]);
        }
        return;
      }
      const tasks = Array.isArray(res.data?.tasks) ? res.data.tasks : [];
      const fp = catalogFingerprint(tasks);
      if (fp !== catalogFpRef.current) {
        catalogFpRef.current = fp;
        setCatalog(tasks);
        setSelection((prev) => pruneSelection(prev, tasks));
        setForm((prev) => {
          if (!prev.category) return prev;
          const still = tasks.some((t) => t.categoryTag === prev.category);
          return still ? prev : { ...prev, category: '' };
        });
      }
      if (!silent) setCatalogError('');
    } catch (err) {
      if (!silent) {
        setCatalogError(err.message || 'Failed to load catalog.');
        setCatalog([]);
      }
    } finally {
      catalogInFlightRef.current = false;
      if (!silent) setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshWinTasks();
    loadCatalog({ silent: false });
    const timer = setInterval(() => {
      loadCatalog({ silent: true });
    }, CATALOG_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshWinTasks, loadCatalog]);

  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'category') {
      setSelection({});
      setTagError('');
    }
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const categories = useMemo(() => uniqueCategories(catalog), [catalog]);
  const catalogGroups = useMemo(() => {
    if (onlyShowActive && form.category) {
      return groupCatalog(catalog, form.category);
    }
    return groupCatalog(catalog, '');
  }, [catalog, form.category, onlyShowActive]);
  const scopeText = useMemo(() => {
    const built = buildScopeFromSelection(selection);
    if (built) return built;
    if (form.category) return '(all tags & exchanges in category)';
    return '';
  }, [form.category, selection]);

  const willTaskCount = useMemo(() => {
    const picked = countWillTasks(
      buildWillRegisterRows(catalog, selection, form.category),
    );
    if (picked > 0) return picked;
    if (form.category && !selectionHasPicks(selection)) {
      return countCategoryTasks(catalog, form.category);
    }
    return 0;
  }, [catalog, form.category, selection]);

  const lockCategory = useCallback((categoryTag) => {
    setForm((f) =>
      f.category === categoryTag ? f : { ...f, category: categoryTag },
    );
  }, []);

  const unlockCategory = useCallback(() => {
    setForm((f) => (f.category ? { ...f, category: '' } : f));
  }, []);

  const keepSameCategory = useCallback((prev, categoryTag) => {
    const sameCatOnly = {};
    for (const [tag, entry] of Object.entries(prev)) {
      if (getSelectionCategory(entry) === categoryTag) {
        sameCatOnly[tag] = {
          categoryTag,
          exchanges: getSelectionExchanges(entry),
        };
      }
    }
    return sameCatOnly;
  }, []);

  /** Apply selection; if no exchanges left → unlock so every category is selectable again. */
  const commitTagSelection = useCallback(
    (next) => {
      const cleaned = pruneEmptySelection(next);
      setSelection(cleaned);
      if (!selectionHasPicks(cleaned)) {
        unlockCategory();
      }
    },
    [unlockCategory],
  );

  const onToggleTag = useCallback(
    (task) => {
      setTagError('');
      const wasOn = isTagSelected(selection, task);
      if (!wasOn) {
        const sameCatOnly = keepSameCategory(selection, task.categoryTag);
        sameCatOnly[task.tag] = {
          categoryTag: task.categoryTag,
          exchanges: [...task.exchanges],
        };
        setSelection(sameCatOnly);
        lockCategory(task.categoryTag);
        return;
      }
      const next = { ...selection };
      delete next[task.tag];
      commitTagSelection(next);
    },
    [commitTagSelection, keepSameCategory, lockCategory, selection],
  );

  /** Click exchange: lock that category, select tag, toggle the exchange. */
  const onToggleExchange = useCallback(
    (task, ex) => {
      setTagError('');
      const sameCatOnly = keepSameCategory(selection, task.categoryTag);
      const already = isTagSelected(selection, task);
      const cur = already ? getSelectionExchanges(selection[task.tag]) : [];
      const nextEx = already
        ? cur.includes(ex)
          ? cur.filter((x) => x !== ex)
          : [...cur, ex]
        : [ex];
      sameCatOnly[task.tag] = {
        categoryTag: task.categoryTag,
        exchanges: nextEx,
      };
      const cleaned = pruneEmptySelection(sameCatOnly);
      setSelection(cleaned);
      if (selectionHasPicks(cleaned)) {
        lockCategory(task.categoryTag);
      } else {
        unlockCategory();
      }
    },
    [keepSameCategory, lockCategory, selection, unlockCategory],
  );

  const onSelectAllExchanges = useCallback(
    (task) => {
      setTagError('');
      if (!isTagSelected(selection, task)) return;
      const cur = getSelectionExchanges(selection[task.tag]);
      const allOn = task.exchanges.every((ex) => cur.includes(ex));
      const next = {
        ...selection,
        [task.tag]: {
          categoryTag: task.categoryTag,
          exchanges: allOn ? [] : [...task.exchanges],
        },
      };
      commitTagSelection(next);
    },
    [commitTagSelection, selection],
  );

  const handleColSplitMouseDown = useCallback((e) => {
    e.preventDefault();
    const panel = colSplitRef.current;
    if (!panel) return;

    const startX = e.clientX;
    const startW = leftWidthRef.current;
    const maxW = Math.max(
      LEFT_WIDTH_MIN,
      panel.clientWidth - SPLITTER_WIDTH - VIEWER_WIDTH_MIN,
    );
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      setLeftWidth(
        Math.min(maxW, Math.max(LEFT_WIDTH_MIN, startW + (ev.clientX - startX))),
      );
    };
    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const handleRowSplitMouseDown = useCallback((e) => {
    e.preventDefault();
    const panel = rowSplitRef.current;
    if (!panel) return;

    const startY = e.clientY;
    const startH = topHeightRef.current;
    const maxH = Math.max(
      TOP_HEIGHT_MIN,
      panel.clientHeight - SPLITTER_HEIGHT - BOTTOM_HEIGHT_MIN,
    );
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      setTopHeight(
        Math.min(maxH, Math.max(TOP_HEIGHT_MIN, startH + (ev.clientY - startY))),
      );
    };
    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const handleReset = useCallback(() => {
    setForm(EMPTY_FORM);
    setSelection({});
    setTagError('');
    setFieldErrors({});
    showToast('info', 'Form reset.');
  }, [showToast]);

  const handleRegister = useCallback(async () => {
    if (registering) return;

    if (!form.env.trim()) {
      setFieldErrors({ env: true });
      showToast('error', 'Please select env.');
      return;
    }
    setFieldErrors({});
    setTagError('');

    const categoryTag =
      form.category.trim() || resolveSelectionCategory(selection);
    if (!categoryTag) {
      showToast(
        'error',
        'Select a Category, or pick a tag/exchange to lock one.',
      );
      return;
    }

    const picked = pruneEmptySelection(selection);
    const selectedEntries = Object.entries(picked);
    const foreign = selectedEntries.find(
      ([, entry]) =>
        getSelectionCategory(entry) &&
        getSelectionCategory(entry) !== categoryTag,
    );
    if (foreign) {
      showToast(
        'error',
        'Selected tags span multiple categories. Pick one category only.',
      );
      return;
    }

    // Empty scope → PS1 registers every tag/exchange under the category.
    const scope = buildScopeFromSelection(picked);

    const api = window.electronAPI;
    if (!api?.registerSchedulerTask) {
      showToast('error', 'Scheduler API unavailable — use npm run electron:dev.');
      return;
    }

    const payload = {
      mode: 'pre-defined',
      env: form.env.trim(),
      categoryTag,
      scope,
    };

    setRegistering(true);
    try {
      const res = await api.registerSchedulerTask(payload);
      if (!res?.ok) {
        const msg = res?.error || 'Register failed.';
        showToast('error', msg.length > 120 ? `${msg.slice(0, 120)}…` : msg);
        return;
      }
      const count = res.data?.count ?? res.data?.tasks?.length ?? 0;
      showToast(
        'success',
        `Registered ${payload.categoryTag} (${payload.env})${count ? ` — ${count} task(s)` : ''}.`,
      );
      setForm((prev) => ({ ...prev, category: categoryTag }));
      await refreshWinTasks();
    } catch (err) {
      showToast('error', err.message || 'Register failed.');
    } finally {
      setRegistering(false);
    }
  }, [form.category, form.env, registering, refreshWinTasks, selection, showToast]);

  const leftProps = {
    form,
    fieldErrors,
    setField,
    categories,
    catalogLoading,
    catalogError,
    onReloadCatalog: () => loadCatalog({ silent: false }),
    onRegister: handleRegister,
    onReset: handleReset,
    registering,
    scopeText,
    willTaskCount,
  };

  const tagProps = {
    category: form.category,
    catalogGroups,
    selection,
    tagError,
    registering,
    onlyShowActive,
    onOnlyShowActiveChange: setOnlyShowActive,
    onToggleTag,
    onToggleExchange,
    onSelectAllExchanges,
  };

  const topPanes = (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto lg:hidden">
        <ScheduleSetup {...leftProps} />
        <ScheduleTagCatalog {...tagProps} />
      </div>

      <div
        ref={colSplitRef}
        className="hidden h-full min-h-0 lg:grid"
        style={{
          gridTemplateColumns: `${leftWidth}px ${SPLITTER_WIDTH}px 1fr`,
        }}
      >
        <div className="min-h-0 min-w-0 overflow-auto">
          <ScheduleSetup {...leftProps} />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize setup and tags"
          title="Drag to resize"
          onMouseDown={handleColSplitMouseDown}
          className="group relative z-10 flex cursor-col-resize items-center justify-center border-x border-border bg-surface hover:bg-blue-50 dark:border-border-dark dark:bg-surface-dark dark:hover:bg-blue-950/40"
        >
          <div className="h-10 w-0.5 rounded-full bg-border group-hover:bg-primary dark:bg-border-dark" />
        </div>

        <div className="min-h-0 min-w-0 overflow-hidden">
          <ScheduleTagCatalog {...tagProps} />
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {toast && (
        <div className="fixed right-4 top-4 z-50 animate-fade-in">
          <div
            className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${TOAST_BG[toast.type]}`}
            role="alert"
          >
            <i className={`fa ${TOAST_ICON[toast.type]}`} />
            {toast.message}
          </div>
        </div>
      )}

      <h2 className="mb-4 shrink-0 text-xl font-semibold">
        <i className="fa fa-calendar mr-2 text-primary" />
        Schedule
      </h2>

      <div
        ref={rowSplitRef}
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateRows: `${topHeight}px ${SPLITTER_HEIGHT}px 1fr`,
        }}
      >
        <div className="min-h-0 overflow-hidden">{topPanes}</div>

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize upper panel and registered tasks"
          title="Drag to resize"
          onMouseDown={handleRowSplitMouseDown}
          className="group relative z-10 flex cursor-row-resize items-center justify-center border-y border-border bg-surface hover:bg-blue-50 dark:border-border-dark dark:bg-surface-dark dark:hover:bg-blue-950/40"
        >
          <div className="h-0.5 w-10 rounded-full bg-border group-hover:bg-primary dark:bg-border-dark" />
        </div>

        <div className="min-h-0 overflow-hidden">
          <ScheduleRegisteredTasks
            tasks={winTasks}
            loading={winLoading}
            error={winError}
            onRefresh={refreshWinTasks}
          />
        </div>
      </div>
    </div>
  );
}

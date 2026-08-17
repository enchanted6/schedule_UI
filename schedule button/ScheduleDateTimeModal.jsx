/**
 * Date + 12-hour time picker for scheduling a FIX Regression run.
 *
 * Visual contract (tasks.txt):
 *   month EN + year — ink-blue bold
 *   « < Today > »  year / month nav
 *   Sun–Sat; weekend red, weekday ink-blue, today black bold
 *   selected day: blue fill, white text
 *   white panel; Time: ink-blue, value black bold, AM/PM click-toggle
 *   Confirm  |  Cancel (black)
 */

import { useEffect, useMemo, useState } from 'react';
import {
  INK,
  MONTH_NAMES,
  WEEKDAYS,
  buildCalendarCells,
  combineDateTime,
  isSameYmd,
  isWeekend,
  nowTimeParts,
  pad2,
  sanitizeDigits,
  shiftMonth,
  shiftYear,
  todayYmd,
} from './datetime';

const inkStyle = { color: INK };

function NavBtn({ label, ariaLabel, onClick }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded text-lg leading-none hover:bg-gray-100"
      style={inkStyle}
    >
      {label}
    </button>
  );
}

export default function ScheduleDateTimeModal({
  open,
  onCancel,
  onConfirm,
}) {
  const [view, setView] = useState(() => {
    const t = todayYmd();
    return { year: t.year, month: t.month };
  });
  const [selected, setSelected] = useState(() => todayYmd());
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');
  const [ampm, setAmpm] = useState('AM');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const t = todayYmd();
    const time = nowTimeParts();
    setView({ year: t.year, month: t.month });
    setSelected(t);
    setHour(String(time.hour12));
    setMinute(pad2(time.minute));
    setAmpm(time.ampm);
    setError('');
  }, [open]);

  const cells = useMemo(
    () => buildCalendarCells(view.year, view.month),
    [view.year, view.month],
  );
  const today = todayYmd();

  if (!open) return null;

  const goToday = () => {
    const t = todayYmd();
    setView({ year: t.year, month: t.month });
    setSelected(t);
    setError('');
  };

  const pickDay = (cell) => {
    setSelected({ year: cell.year, month: cell.month, day: cell.day });
    if (!cell.inMonth) {
      setView({ year: cell.year, month: cell.month });
    }
    setError('');
  };

  const handleConfirm = () => {
    const hourNum = hour === '' ? NaN : Number(hour);
    const minuteNum = minute === '' ? NaN : Number(minute);
    const date = combineDateTime(selected, hourNum, minuteNum, ampm);
    if (!date) {
      setError('Select a date and a valid time.');
      return;
    }
    if (date <= new Date()) {
      setError('Cannot schedule in the past.');
      return;
    }
    onConfirm(date);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-[340px] max-w-[92vw] bg-white px-5 py-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-datetime-title"
      >
        <h3
          id="schedule-datetime-title"
          className="mb-2 text-center text-base font-bold"
          style={inkStyle}
        >
          {MONTH_NAMES[view.month]}, {view.year}
        </h3>

        <div className="border-t border-gray-300" />

        <div className="my-2 flex items-center justify-between">
          <NavBtn
            label="«"
            ariaLabel="Previous year"
            onClick={() => setView((v) => shiftYear(v.year, v.month, -1))}
          />
          <NavBtn
            label="<"
            ariaLabel="Previous month"
            onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
          />
          <button
            type="button"
            onClick={goToday}
            className="px-4 text-sm font-medium hover:underline"
            style={inkStyle}
          >
            Today
          </button>
          <NavBtn
            label=">"
            ariaLabel="Next month"
            onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
          />
          <NavBtn
            label="»"
            ariaLabel="Next year"
            onClick={() => setView((v) => shiftYear(v.year, v.month, 1))}
          />
        </div>

        <div className="grid grid-cols-7 text-center text-xs font-medium text-gray-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 text-center text-sm">
          {cells.map((cell) => {
            const dow = new Date(cell.year, cell.month, cell.day).getDay();
            const isToday = isSameYmd(cell, today);
            const isSelected = isSameYmd(cell, selected);
            const weekend = isWeekend(dow);

            let color = INK;
            let weight = 'font-normal';
            if (!cell.inMonth) {
              color = '#c0c4cc';
            } else if (isSelected) {
              color = '#ffffff';
              weight = 'font-bold';
            } else if (isToday) {
              color = '#000000';
              weight = 'font-bold';
            } else if (weekend) {
              color = '#f53f3f';
            }

            return (
              <button
                key={`${cell.year}-${cell.month}-${cell.day}-${cell.inMonth}`}
                type="button"
                onClick={() => pickDay(cell)}
                className={`mx-auto my-0.5 flex h-8 w-8 items-center justify-center ${weight} ${
                  isSelected ? 'bg-primary text-white' : 'hover:bg-gray-100'
                }`}
                style={isSelected ? undefined : { color }}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        <div className="mt-2 border-t border-gray-300" />

        <div className="flex items-center gap-3 py-3">
          <span className="text-sm font-medium" style={inkStyle}>
            Time:
          </span>
          <div className="flex flex-1 items-center justify-center gap-0.5 font-bold text-black">
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="??"
              aria-label="Hour"
              value={hour}
              onChange={(e) => {
                setHour(sanitizeDigits(e.target.value, 2, 12));
                setError('');
              }}
              onBlur={() => {
                if (hour === '' || hour === '0') return;
                const n = Number(hour);
                if (n >= 1 && n <= 12) setHour(String(n));
              }}
              className="w-8 bg-transparent text-center text-base font-bold text-black outline-none placeholder:font-bold placeholder:text-gray-400"
            />
            <span className="text-base font-bold">:</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="??"
              aria-label="Minute"
              value={minute}
              onChange={(e) => {
                setMinute(sanitizeDigits(e.target.value, 2, 59));
                setError('');
              }}
              onBlur={() => {
                if (minute === '') return;
                setMinute(pad2(Number(minute)));
              }}
              className="w-8 bg-transparent text-center text-base font-bold text-black outline-none placeholder:font-bold placeholder:text-gray-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setAmpm((v) => (v === 'AM' ? 'PM' : 'AM'))}
            className="min-w-[2.5rem] text-right text-sm font-bold text-black hover:underline"
            aria-label="Toggle AM/PM"
          >
            {ampm}
          </button>
        </div>

        <div className="border-t border-gray-300" />

        <p className="py-2 text-center text-sm" style={inkStyle}>
          Select a date and time
        </p>

        {error && (
          <p className="pb-2 text-center text-xs text-danger">{error}</p>
        )}

        <div className="border-t border-gray-300" />

        <div className="flex items-center justify-between pt-3">
          <button
            type="button"
            onClick={handleConfirm}
            className="text-sm font-medium hover:underline"
            style={inkStyle}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm font-medium text-black hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

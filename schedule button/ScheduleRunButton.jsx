/**
 * Standalone trigger that opens ScheduleDateTimeModal.
 * FIX Regression wires the modal via the Run dropdown instead.
 */

import { useState } from 'react';
import ScheduleDateTimeModal from './ScheduleDateTimeModal';
import { formatDateTime } from './datetime';

export default function ScheduleRunButton({
  disabled = false,
  onConfirm,
  className = '',
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={
          className ||
          'btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50'
        }
      >
        <i className="fa fa-calendar" />
        Schedule Run
      </button>

      <ScheduleDateTimeModal
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={(date) => {
          onConfirm?.(date, formatDateTime(date));
          setOpen(false);
        }}
      />
    </>
  );
}

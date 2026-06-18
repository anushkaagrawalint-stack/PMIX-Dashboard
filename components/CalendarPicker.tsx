'use client';
import { useState, useEffect } from 'react';

interface Props {
  startDate: string;
  endDate:   string;
  dbMin:     string;
  dbMax:     string;
  onApply:   (start: string, end: string) => void;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function toUtcDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function firstDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 1)).getUTCDay();
}

function clamp(s: string, lo: string, hi: string): string {
  if (s < lo) return lo;
  if (s > hi) return hi;
  return s;
}

export default function CalendarPicker({ startDate, endDate, dbMin, dbMax, onApply }: Props) {
  const initDate = toUtcDate(endDate || dbMax);
  const [viewYear,  setViewYear]  = useState(initDate.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getUTCMonth());
  const [selStart,  setSelStart]  = useState<string>(startDate || '');
  const [selEnd,    setSelEnd]    = useState<string>(endDate   || '');
  const [hover,     setHover]     = useState<string>('');

  useEffect(() => { setSelStart(startDate || ''); setSelEnd(endDate || ''); }, [startDate, endDate]);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  function clickDay(dateStr: string) {
    if (dateStr < dbMin || dateStr > dbMax) return;
    if (!selStart || (selStart && selEnd)) {
      setSelStart(dateStr);
      setSelEnd('');
    } else {
      if (dateStr >= selStart) {
        setSelEnd(dateStr);
      } else {
        setSelStart(dateStr);
        setSelEnd('');
      }
    }
  }

  function inRange(dateStr: string): boolean {
    const lo = selStart;
    const hi = selEnd || hover;
    if (!lo || !hi) return false;
    const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
    return dateStr > a && dateStr < b;
  }

  function isEdge(dateStr: string): 'start' | 'end' | null {
    if (dateStr === selStart) return 'start';
    if (dateStr === selEnd)   return 'end';
    return null;
  }

  const today = fmtDate(new Date());
  const numDays   = daysInMonth(viewYear, viewMonth);
  const firstDay  = firstDayOfMonth(viewYear, viewMonth);
  const cells: (string | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= numDays; d++) {
    const m = String(viewMonth + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    cells.push(`${viewYear}-${m}-${dd}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const canApply = !!(selStart && selEnd && selStart <= selEnd);

  return (
    <div style={{ padding: '4px 6px', userSelect: 'none' }}>
      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <button onClick={prevMonth} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, padding: '2px 6px', borderRadius: 4 }}>‹</button>
        <span style={{ fontSize: 11, fontWeight: 700 }}>{MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, padding: '2px 6px', borderRadius: 4 }}>›</button>
      </div>

      {/* Day-of-week header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 2 }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: 'var(--muted)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={i} />;
          const disabled  = dateStr < dbMin || dateStr > dbMax;
          const edge      = isEdge(dateStr);
          const ranged    = inRange(dateStr);
          const isToday   = dateStr === today;

          let bg = 'transparent';
          let color = disabled ? '#d1d5db' : 'var(--text)';
          let fw: number | string = 400;
          let br = '50%';

          if (edge === 'start' || edge === 'end') {
            bg = '#381d7c';
            color = '#fff';
            fw = 700;
          } else if (ranged) {
            bg = '#ede9fe';
            color = '#5b21b6';
            br = '0';
          }

          return (
            <div
              key={dateStr}
              onClick={() => clickDay(dateStr)}
              onMouseEnter={() => !selEnd && setHover(dateStr)}
              onMouseLeave={() => setHover('')}
              style={{
                textAlign: 'center', padding: '4px 0', fontSize: 10, fontWeight: fw,
                borderRadius: br, background: bg, color,
                cursor: disabled ? 'not-allowed' : 'pointer',
                position: 'relative',
                transition: 'background .1s',
              }}
            >
              {Number(dateStr.slice(8))}
              {isToday && !edge && (
                <div style={{ position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)', width: 3, height: 3, borderRadius: '50%', background: 'var(--accent)' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Selection display */}
      <div style={{ display: 'flex', gap: 4, marginTop: 8, fontSize: 10, color: 'var(--muted)', justifyContent: 'space-between' }}>
        <div style={{ background: '#f9fafb', borderRadius: 6, padding: '3px 8px', flex: 1, textAlign: 'center' }}>
          {selStart || 'From'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)', fontSize: 10 }}>→</div>
        <div style={{ background: '#f9fafb', borderRadius: 6, padding: '3px 8px', flex: 1, textAlign: 'center' }}>
          {selEnd || 'To'}
        </div>
      </div>

      <button
        onClick={() => canApply && onApply(selStart, selEnd)}
        disabled={!canApply}
        style={{
          marginTop: 7, width: '100%', padding: '5px 0', borderRadius: 6, border: 'none',
          background: canApply ? 'var(--accent)' : '#e5e7eb',
          color: canApply ? '#fff' : '#9ca3af',
          fontSize: 11, fontWeight: 700, cursor: canApply ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
        }}
      >
        Apply range
      </button>

      {(selStart || selEnd) && (
        <div
          onClick={() => { setSelStart(''); setSelEnd(''); }}
          style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', marginTop: 4, cursor: 'pointer' }}
        >
          Clear
        </div>
      )}
    </div>
  );
}

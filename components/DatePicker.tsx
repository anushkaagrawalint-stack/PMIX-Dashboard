'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { DateRange, FiscalPeriodRow } from '@/lib/types';
import CalendarPicker from './CalendarPicker';

interface Props { dr: DateRange; periods: FiscalPeriodRow[] }

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function firstOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${y}-${m}-01`;
}

function firstOfYear(dateStr: string): string {
  return `${dateStr.slice(0, 4)}-01-01`;
}

const QUARTERS = [
  { label: 'Q1', months: 'Jan–Mar', start: '01-01', end: '03-31' },
  { label: 'Q2', months: 'Apr–Jun', start: '04-01', end: '06-30' },
  { label: 'Q3', months: 'Jul–Sep', start: '07-01', end: '09-30' },
  { label: 'Q4', months: 'Oct–Dec', start: '10-01', end: '12-31' },
];

export default function DatePicker({ dr, periods }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const year = Number(dr.dbMax.slice(0, 4));

  const presets = [
    { label: 'Last 7 Days',  start: addDays(dr.dbMax, -6),  end: dr.dbMax },
    { label: 'Last 14 Days', start: addDays(dr.dbMax, -13), end: dr.dbMax },
    { label: 'Last 4 Weeks', start: addDays(dr.dbMax, -27), end: dr.dbMax },
    { label: 'This Month',   start: firstOfMonth(dr.dbMax), end: dr.dbMax },
    { label: 'YTD',          start: firstOfYear(dr.dbMax),  end: dr.dbMax },
  ];

  const activePeriod = periods.find(p => dr.start === p.start_date && dr.end === p.end_date);

  // Group periods by fiscal year, sorted P1→P13 within each year
  const yearGroups: { year: number; rows: FiscalPeriodRow[] }[] = [];
  const yearMap = new Map<number, FiscalPeriodRow[]>();
  periods.forEach(p => {
    if (!yearMap.has(p.fiscal_year)) yearMap.set(p.fiscal_year, []);
    yearMap.get(p.fiscal_year)!.push(p);
  });
  [...yearMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .forEach(([yr, rows]) => {
      yearGroups.push({ year: yr, rows: rows.sort((a, b) => a.period - b.period) });
    });

  function go(start: string, end: string, label: string) {
    router.push(`/?start=${start}&end=${end}&label=${encodeURIComponent(label)}`);
    setOpen(false);
  }

  const btnLabel = activePeriod ? activePeriod.label : dr.label;

  return (
    <div ref={ref} className="drw">
      <button className="drb" onClick={() => setOpen(v => !v)}>
        <i className="ti ti-calendar" style={{ fontSize: 11 }} />
        {btnLabel}
        <i className={`ti ti-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 10 }} />
      </button>

      <div className={`drm${open ? ' open' : ''}`} style={{ minWidth: 250 }}>

        {/* Quick select */}
        <div className="dr-sec">Quick select</div>
        {presets.map(p => {
          const active = !activePeriod && dr.start === p.start && dr.end === p.end;
          return (
            <div key={p.label} className={`dr-it${active ? ' on' : ''}`} onClick={() => go(p.start, p.end, p.label)}>
              {active && <i className="ti ti-check" style={{ fontSize: 10 }} />}
              {p.label}
            </div>
          );
        })}

        <div className="dr-div" />

        {/* Quarter */}
        <div className="dr-sec">Quarter {year}</div>
        {QUARTERS.map(q => {
          const qStart = `${year}-${q.start}`;
          const qEnd   = `${year}-${q.end}`;
          const active = dr.start === qStart && dr.end === qEnd;
          return (
            <div key={q.label} className={`dr-it${active ? ' on' : ''}`} onClick={() => go(qStart, qEnd, `${q.label} ${year}`)}>
              {active && <i className="ti ti-check" style={{ fontSize: 10 }} />}
              {q.label} {year} ({q.months})
            </div>
          );
        })}

        {/* Fiscal Periods — all, grouped by year */}
        {yearGroups.length > 0 && (
          <>
            <div className="dr-div" />
            {yearGroups.map(({ year: fy, rows }) => (
              <div key={fy}>
                <div className="dr-sec">FY {fy}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '2px 8px 6px' }}>
                  {rows.map(p => {
                    const active = activePeriod?.period === p.period && activePeriod?.fiscal_year === p.fiscal_year;
                    return (
                      <button
                        key={`${p.period}-${p.fiscal_year}`}
                        onClick={() => go(p.start_date, p.end_date, p.label)}
                        title={`${p.start_date} → ${p.end_date}`}
                        style={{
                          padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                          cursor: 'pointer', border: '1px solid',
                          borderColor: active ? 'transparent' : 'var(--border)',
                          background: active ? '#381d7c' : 'var(--bg)',
                          color: active ? '#fff' : 'var(--text)',
                          fontFamily: 'inherit',
                        }}
                      >
                        P{p.period}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        <div className="dr-div" />

        {/* Calendar */}
        <div className="dr-sec">Custom range</div>
        <CalendarPicker
          startDate={dr.start}
          endDate={dr.end}
          dbMin={dr.dbMin}
          dbMax={dr.dbMax}
          onApply={(start, end) => go(start, end, `${start} → ${end}`)}
        />

        <div className="dr-reset" onClick={() => { router.push('/'); setOpen(false); }}>
          Reset to default
        </div>

      </div>
    </div>
  );
}

import Image from 'next/image';

export default function Loading() {
  return (
    <div className="container">

      {/* Header shell */}
      <div className="hdr">
        <div className="hdr-l">
          <div className="rasa-box">
            <Image src="/rasa-logo.png" alt="RASA" width={120} height={39} style={{ height: 20, width: 'auto', display: 'block' }} priority />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="hdr-title">Product Mix Dashboard</span>
              <span className="pbadge">Loading…</span>
            </div>
            <div className="hdr-sub">Fetching data…</div>
          </div>
        </div>
        <div className="hdr-r">
          <div className="hdr-status">
            <span className="loading-spinner" />
            Querying database…
          </div>
          <span className="klogo">
            <Image src="/kutlerri-logo.png" alt="Kutlerri" width={120} height={39} style={{ height: 16, width: 'auto', display: 'block' }} priority />
          </span>
        </div>
      </div>

      {/* Filter bar skeleton */}
      <div className="fb">
        <div className="fb-r">
          <div className="skel" style={{ width: 60, height: 14 }} />
          <div className="skel" style={{ width: 120, height: 30, borderRadius: 8 }} />
          <div className="fb-sep" />
          <div className="skel" style={{ width: 50, height: 14 }} />
          <div className="skel" style={{ width: 130, height: 30, borderRadius: 8 }} />
          <div className="fb-sep" />
          <div className="skel" style={{ width: 55, height: 14 }} />
          <div className="skel" style={{ width: 140, height: 30, borderRadius: 8 }} />
          <div className="skel" style={{ width: 110, height: 14, marginLeft: 'auto' }} />
        </div>
      </div>

      {/* Tabs skeleton */}
      <div className="tabs-o">
        <div className="tabs-i" style={{ padding: '8px 6px', gap: 4 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="skel" style={{ width: 90 + (i % 3) * 20, height: 32, borderRadius: 6, flexShrink: 0 }} />
          ))}
        </div>
      </div>

      {/* KPI cards skeleton */}
      <div className="krow" style={{ marginBottom: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kc" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skel" style={{ width: '60%', height: 10 }} />
            <div className="skel" style={{ width: '80%', height: 26 }} />
            <div className="skel" style={{ width: '50%', height: 9 }} />
          </div>
        ))}
      </div>

      {/* Chart area skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        {[200, 240].map((h, i) => (
          <div key={i} className="cc" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skel" style={{ width: '40%', height: 10 }} />
            <div className="skel" style={{ width: '100%', height: h, borderRadius: 6 }} />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="tw">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
            <div className="skel" style={{ width: 160, height: 28, borderRadius: 8 }} />
            <div className="skel" style={{ width: 120, height: 28, borderRadius: 8, marginLeft: 'auto' }} />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="skel" style={{ width: '28%', height: 13 }} />
              <div className="skel" style={{ width: '12%', height: 13 }} />
              <div className="skel" style={{ width: '10%', height: 13 }} />
              <div className="skel" style={{ width: '14%', height: 13 }} />
              <div className="skel" style={{ width: '10%', height: 13 }} />
              <div className="skel" style={{ width: '10%', height: 13 }} />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .skel {
          background: linear-gradient(90deg, var(--border) 25%, #e5e7eb 50%, var(--border) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.4s infinite;
          border-radius: 4px;
          flex-shrink: 0;
        }
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .loading-spinner {
          width: 8px;
          height: 8px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          display: inline-block;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

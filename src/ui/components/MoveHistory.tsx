import { useEffect, useRef } from 'react';
import type { HistoryEntry } from '../../engine';

interface MoveHistoryProps {
  history: readonly HistoryEntry[];
}

interface Row {
  number: number;
  white: string[];
  black: string[];
}

/**
 * Groups the flat history into "1. e4 e5" rows by the actual mover — a player
 * with a free move (Duelist) can have two entries in one turn, shown joined:
 * "1. Dc3·Dd4 e5".
 */
function toRows(history: readonly HistoryEntry[]): Row[] {
  const rows: Row[] = [];
  for (const entry of history) {
    const last = rows[rows.length - 1];
    const actor = entry.move?.color ?? entry.cast?.color ?? 'white';
    if (actor === 'white') {
      if (!last || last.black.length > 0) {
        rows.push({ number: rows.length + 1, white: [entry.san], black: [] });
      } else {
        last.white.push(entry.san);
      }
    } else {
      if (!last) rows.push({ number: 1, white: [], black: [entry.san] });
      else last.black.push(entry.san);
    }
  }
  return rows;
}

export function MoveHistory({ history }: MoveHistoryProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = toRows(history);
  const lastEntry = history.at(-1);
  const lastColor = lastEntry?.move?.color ?? lastEntry?.cast?.color;

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [history.length]);

  return (
    <section className="panel history">
      <h2 className="panel__title">Move history</h2>
      <div className="history__scroll" ref={scroller}>
        {rows.length === 0 ? (
          <p className="history__empty">No moves yet.</p>
        ) : (
          <ol className="history__list">
            {rows.map((row, index) => {
              const isLast = index === rows.length - 1;
              return (
                <li key={row.number} className="history__row">
                  <span className="history__number">{row.number}.</span>
                  <span
                    className={`history__san${isLast && lastColor === 'white' && row.black.length === 0 ? ' history__san--latest' : ''}`}
                  >
                    {row.white.join('·')}
                  </span>
                  <span
                    className={`history__san${isLast && lastColor === 'black' ? ' history__san--latest' : ''}`}
                  >
                    {row.black.join('·')}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

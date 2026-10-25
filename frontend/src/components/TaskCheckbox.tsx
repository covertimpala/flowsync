import { useState } from 'react';

/** A circular checkbox with a pop + draw-in animation on check — plain
 * `<input type="checkbox">` can't be styled enough to feel rewarding.
 * Calls `onComplete` with the click's viewport position (0–1 fractions)
 * only on the false→true transition, so the caller can anchor a confetti
 * burst there. */
export function TaskCheckbox({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: (completing: boolean, origin: { x: number; y: number }) => void;
}) {
  const [popping, setPopping] = useState(false);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    const completing = !checked;
    if (completing) {
      setPopping(true);
      setTimeout(() => setPopping(false), 320);
    }
    const origin = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    onToggle(completing, origin);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={checked}
      aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
      style={{
        width: 20,
        height: 20,
        minWidth: 20,
        borderRadius: '50%',
        border: `2px solid ${checked ? 'var(--success)' : 'var(--border)'}`,
        background: checked ? 'var(--success)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        transform: popping ? 'scale(1.35)' : 'scale(1)',
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          opacity: checked ? 1 : 0,
          transform: checked ? 'scale(1)' : 'scale(0.4)',
          transition: 'opacity 0.2s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </button>
  );
}

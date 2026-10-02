const positions: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
function Pips({ value }: { value: number }) {
  return (
    <span className="pips">
      {Array.from({ length: 9 }, (_, index) => (
        <i
          key={index}
          className={positions[value]?.includes(index) ? 'pip filled' : 'pip'}
        />
      ))}
    </span>
  );
}
export function Domino({ left, right }: { left: number; right: number }) {
  return (
    <span
      aria-hidden="true"
      className={`domino ${left === right ? 'double' : ''}`}
    >
      <Pips value={left} />
      <span className="tile-divider" />
      <Pips value={right} />
    </span>
  );
}

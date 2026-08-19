import { useTableFxStore } from "./tableFx";

export function ChipFlyLayer() {
  const flying = useTableFxStore((s) => s.fx.flying);
  return (
    <div id="chip-animation-layer" aria-hidden="true">
      {flying.map((chip) => (
        <div
          key={chip.id}
          className="chip-flying"
          style={{
            left: `${chip.x}px`,
            top: `${chip.y}px`,
            ["--fly-dx" as string]: `${chip.dx}px`,
            ["--fly-dy" as string]: `${chip.dy}px`,
            ["--fly-duration" as string]: `${chip.duration}ms`,
            ["--fly-delay" as string]: `${chip.delay}ms`,
          }}
        >
          <div className="chip-icon" />
          {chip.amount}
        </div>
      ))}
    </div>
  );
}
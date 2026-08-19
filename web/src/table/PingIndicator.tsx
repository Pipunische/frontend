export function PingIndicator({ pingMs }: { pingMs: number }) {
  let signal = "signal-bad";
  let title = "Нет связи с сервером...";
  if (pingMs < 150) {
    signal = "signal-good";
    title = `Пинг: ${pingMs} мс (Отлично)`;
  } else if (pingMs < 500) {
    signal = "signal-medium";
    title = `Пинг: ${pingMs} мс (Средне)`;
  } else if (pingMs !== 9999) {
    title = `Пинг: ${pingMs} мс (Плохо)`;
  }

  return (
    <div
      id="ping-indicator"
      className={`ping-indicator table-ping ${signal}`}
      title={title}
    >
      <div className="bar bar-1" />
      <div className="bar bar-2" />
      <div className="bar bar-3" />
    </div>
  );
}

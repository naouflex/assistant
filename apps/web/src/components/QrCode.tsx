import { useEffect, useState } from "react";

const QR_QUIET_ZONE = 2;

/** Dark modules as one SVG path, with a quiet zone so a phone camera can read it. */
function qrPath(data: Uint8Array, size: number): string {
  let path = "";
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!data[row * size + col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && data[row * size + col]) col += 1;
      const width = col - start;
      path += `M${start + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h${width}v1h-${width}z`;
    }
  }
  return path;
}

export function QrMark({ value, testId }: { value: string; testId?: string }) {
  const [symbol, setSymbol] = useState<{ size: number; path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then((qrcode) => {
      if (cancelled) return;
      const symbol = qrcode.create(value, { errorCorrectionLevel: "M" });
      setSymbol({
        size: symbol.modules.size + QR_QUIET_ZONE * 2,
        path: qrPath(symbol.modules.data, symbol.modules.size),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <svg
      viewBox={symbol ? `0 0 ${symbol.size} ${symbol.size}` : "0 0 1 1"}
      className="size-40 bg-white text-black"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-testid={testId}
    >
      {symbol ? <path d={symbol.path} fill="currentColor" /> : null}
    </svg>
  );
}

"use client";

import { useRef, useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip
);

interface EquityCurveChartProps {
  data: number[];
  hwm: string;
}

export default function EquityCurveChart({ data, hwm }: EquityCurveChartProps) {
  const chartRef = useRef<ChartJS<"line">>(null);
  const [gradient, setGradient] = useState<CanvasGradient | string>(
    "rgba(45, 212, 45, 0.1)"
  );

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ctx = chart.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, "rgba(45, 212, 45, 0.15)");
    g.addColorStop(1, "rgba(45, 212, 45, 0)");
    setGradient(g);
  }, []);

  const labels = Array.from({ length: data.length }, (_, i) => i + 1);

  return (
    <div className="chart-container">
      <div className="panel-title font-[family-name:var(--font-jetbrains-mono)]">
        <span>Equity Curve (30D)</span>
        <span style={{ color: "var(--color-accent)" }}>HWM: {hwm}</span>
      </div>
      <div style={{ height: "280px", width: "100%" }}>
        <Line
          ref={chartRef}
          data={{
            labels,
            datasets: [
              {
                label: "Portfolio Value",
                data,
                borderColor: "#2dd42d",
                borderWidth: 2,
                fill: true,
                backgroundColor: gradient,
                tension: 0.4,
                pointRadius: 0,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
            scales: {
              x: { display: false },
              y: {
                grid: { color: "rgba(255,255,255,0.05)" },
                ticks: {
                  color: "rgba(255,255,255,0.3)",
                  font: { size: 10, family: "JetBrains Mono" },
                },
              },
            },
          }}
        />
      </div>
    </div>
  );
}

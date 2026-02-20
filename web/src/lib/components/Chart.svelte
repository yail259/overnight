<script lang="ts">
  import { onMount } from "svelte";
  import { createChart, type IChartApi, ColorType, LineStyle } from "lightweight-charts";

  let { timestamps, values }: { timestamps: number[]; values: number[] } = $props();

  let container: HTMLDivElement;
  let chart: IChartApi;

  onMount(() => {
    chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8888a0",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1a1a25", style: LineStyle.Dotted },
        horzLines: { color: "#1a1a25", style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: "#2a2a3a",
      },
      timeScale: {
        borderColor: "#2a2a3a",
        timeVisible: false,
      },
      crosshair: {
        vertLine: { color: "#6366f1", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "#6366f1", width: 1, style: LineStyle.Dashed },
      },
      handleScroll: false,
      handleScale: false,
    });

    const areaSeries = chart.addAreaSeries({
      lineColor: "#6366f1",
      topColor: "rgba(99, 102, 241, 0.3)",
      bottomColor: "rgba(99, 102, 241, 0.02)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });

    const data = timestamps.map((t, i) => ({
      time: (t as number) as any,
      value: values[i],
    }));

    areaSeries.setData(data);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.resize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  });
</script>

<div bind:this={container} class="w-full h-full"></div>

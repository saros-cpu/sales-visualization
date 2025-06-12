// src/hooks/useChart.js — ECharts 通用 hook
import { useRef, useEffect, useCallback } from 'react';

/**
 * 管理 ECharts 实例的生命周期
 * @returns {{ chartRef: React.RefObject, initChart: (elId: string) => echartsInstance|null }}
 */
export function useChart() {
  const chartRef = useRef(null);

  const initChart = useCallback((elId) => {
    if (!window.echarts) return null;
    const el = document.getElementById(elId);
    if (!el) return null;
    if (!chartRef.current) {
      chartRef.current = window.echarts.init(el);
    }
    return chartRef.current;
  }, []);

  useEffect(() => {
    const handleResize = () => chartRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  const init = initChart;
  const getInstance = useCallback(() => chartRef.current, []);

  return { chartRef, initChart, init, getInstance };
}

/**
 * 渲染"无数据"占位
 */
export function noDataOption(chart, text) {
  chart?.setOption({
    backgroundColor: 'transparent',
    title: {
      text,
      left: 'center',
      top: 'middle',
      textStyle: { color: 'rgba(160, 180, 210, 0.72)', fontSize: 13, fontWeight: 500 },
    },
    xAxis: { show: false },
    yAxis: { show: false },
    series: [],
  }, true);
}

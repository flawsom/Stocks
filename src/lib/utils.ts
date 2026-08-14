import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number, decimals?: number): string {
  if (decimals !== undefined) return price.toFixed(decimals);
  if (price === 0) return "—";
  if (price < 0.001) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  if (price < 100) return price.toFixed(4);
  if (price < 10000) return price.toFixed(2);
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(1)}K`;
  return volume.toFixed(0);
}

export function formatPct(pct: number, sign = true): string {
  const str = Math.abs(pct).toFixed(2) + "%";
  if (!sign) return str;
  return (pct >= 0 ? "+" : "−") + str;
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

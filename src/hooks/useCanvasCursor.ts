import { useEffect } from "react";

/**
 * useCanvasCursor — the classic multi-line "trailing cursor" effect,
 * hardened for production use across every page of the app.
 *
 * Fixes over the stock CodePen version:
 *  - Touch-aware: tracks the first touch, and never calls preventDefault(),
 *    so page scrolling / pinch-zoom keep working on mobile.
 *  - No NaN geometry: lines are only spawned once a real pointer position
 *    exists, so the first frame is never drawn at (undefined, undefined).
 *  - Battery-friendly: the requestAnimationFrame loop stops on window blur
 *    and resumes on focus (the original kept rendering in the background).
 *  - Clean teardown: every listener is a named handler and is removed on
 *    unmount (the original leaked focus/blur listeners).
 *  - Accessibility: respects prefers-reduced-motion by doing nothing.
 *  - Retina-crisp: canvas is sized in device pixels and the context is
 *    scaled by devicePixelRatio so the 1px strokes stay sharp on hi-DPI.
 *  - Themed: the hue drifts around the editorial green family (offset ~130°)
 *    instead of the stock purple, so it belongs to the bone-white system.
 *
 * Requires a <canvas id="canvas" /> element to exist in the tree (App.tsx).
 */

interface Phase {
  update: () => number;
  value: () => number;
}

interface Node2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Point {
  x: number;
  y: number;
}

const TRAIL = {
  friction: 0.5,
  trails: 20,
  size: 50,
  dampening: 0.25,
  tension: 0.98,
};

const HUE = { offset: 130, amplitude: 70, frequency: 0.0015 };

function createPhase(opts: { offset: number; amplitude: number; frequency: number }): Phase {
  let phase = Math.random() * 2 * Math.PI;
  let value = opts.offset;
  return {
    update() {
      phase += opts.frequency;
      value = opts.offset + Math.sin(phase) * opts.amplitude;
      return value;
    },
    value() {
      return value;
    },
  };
}

function createNode(x: number, y: number): Node2D {
  return { x, y, vx: 0, vy: 0 };
}

class Line {
  spring: number;
  friction: number;
  nodes: Node2D[];

  constructor(spring: number, pos: Point) {
    this.spring = spring + 0.1 * Math.random() - 0.02;
    this.friction = TRAIL.friction + 0.01 * Math.random() - 0.002;
    this.nodes = [];
    for (let i = 0; i < TRAIL.size; i++) {
      this.nodes.push(createNode(pos.x, pos.y));
    }
  }

  update(pos: Point) {
    const spring = this.spring;
    const head = this.nodes[0];
    head.vx += (pos.x - head.x) * spring;
    head.vy += (pos.y - head.y) * spring;
    let e = spring;
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (i > 0) {
        const prev = this.nodes[i - 1];
        node.vx += (prev.x - node.x) * e;
        node.vy += (prev.y - node.y) * e;
        node.vx += prev.vx * TRAIL.dampening;
        node.vy += prev.vy * TRAIL.dampening;
      }
      node.vx *= this.friction;
      node.vy *= this.friction;
      node.x += node.vx;
      node.y += node.vy;
      e *= TRAIL.tension;
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const nodes = this.nodes;
    const last = nodes.length - 2;
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < last; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      ctx.quadraticCurveTo(a.x, a.y, 0.5 * (a.x + b.x), 0.5 * (a.y + b.y));
    }
    const a = nodes[last];
    const b = nodes[last + 1];
    ctx.quadraticCurveTo(a.x, a.y, b.x, b.y);
    ctx.stroke();
  }
}

export default function useCanvasCursor() {
  useEffect(() => {
    const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let running = false;
    let raf = 0;
    let hasPos = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pos: Point = { x: 0, y: 0 };
    let lines: Line[] = [];
    const hue = createPhase(HUE);

    function resize() {
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    }

    function spawn() {
      lines = [];
      for (let i = 0; i < TRAIL.trails; i++) {
        lines.push(new Line(0.4 + (i / TRAIL.trails) * 0.025, pos));
      }
    }

    function render() {
      if (!running) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${Math.round(hue.update())}, 70%, 52%, 0.22)`;
      ctx.lineWidth = 1;
      for (const line of lines) {
        line.update(pos);
        line.draw(ctx);
      }
      raf = window.requestAnimationFrame(render);
    }

    function startIfNeeded() {
      if (!running) {
        running = true;
        raf = window.requestAnimationFrame(render);
      }
    }

    function setPointer(clientX: number, clientY: number) {
      pos.x = clientX;
      pos.y = clientY;
      if (!hasPos) {
        hasPos = true;
        spawn();
      }
      startIfNeeded();
    }

    const onMouseMove = (e: MouseEvent) => setPointer(e.clientX, e.clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        setPointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        setPointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onResize = () => resize();
    const onFocus = () => {
      if (hasPos) startIfNeeded();
    };
    const onBlur = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}

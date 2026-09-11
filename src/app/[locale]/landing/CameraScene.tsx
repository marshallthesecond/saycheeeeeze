"use client";

// src/app/[locale]/landing/CameraScene.tsx
//
// The camera, demoted. It appears in three scenes and nowhere else:
//
//   phase "hook"    scene 1 — rotates to show its back, the screen wakes
//   phase "before"  scene 3 — small and angled, one iris snap
//   phase "book"    scene 7 — far, dim, lens toward the viewer
//
// Removed from the previous version, deliberately:
//   · the exploded view and its four DOM gear labels (sensor / mount / iris /
//     evf) — a spec sheet is not a story
//   · the six ejected photo cards — photographs are DOM images now, so they
//     stay sharp on a phone
//   · the lens detach/twist and the zoom-barrel extension
//   · the second shutter click
//   · 420 additively-blended dust points — the star field is SVG now, in
//     Atmosphere, so it survives in the four scenes with no WebGL
//
// The rig also changed: the old rim light was #ffc07a at intensity 3.0 against
// a cool background, which is what made the body read brown and every bevel
// read gold. It's cool and half as strong now.
//
// Fail-safes, unchanged in spirit: no WebGL → the canvas stays empty and every
// scene still reads, because nothing lives behind the 3D. prefers-reduced-
// motion → no spring, no tilt, no idle bob.

import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { useSceneProgress, track, ramp, type Stop } from "./ScrollStage";

type ThreeNS = typeof import("three");

export type CameraPhase = "hook" | "before" | "book" | null;

/**
 * How much of the frame the camera body is allowed to fill, as a fraction of
 * the viewport in each axis. 0.86 horizontally means the silhouette can never
 * be wider than 86% of the screen — 7% of clear space down each edge, on any
 * phone, at any angle. Lower it if you want the object to sit smaller; the
 * choreography's radius track becomes a floor rather than the final word.
 *
 * Vertical is looser because the model is deliberately pushed into the upper
 * band on mobile, so it sits off-centre in y by design.
 */
const FIT_X = 0.86;
const FIT_Y = 0.94;

/**
 * Where the camera's rear screen is on the glass, in viewport percentages,
 * rewritten every frame of scene 1.
 *
 * x/y/w/h describe an upright box; `rot` is the roll that box needs to sit
 * square on the LCD, which is never zero because the body carries a velocity
 * tilt. The old version reported the axis-aligned bounding box of the four
 * projected corners, which is a different and always-larger rectangle than the
 * screen itself as soon as the body is turned even slightly — that is what made
 * the photograph appear off the screen rather than on it.
 */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, for a CSS rotate() on the receiving element. */
  rot: number;
  /** 1 when the LCD is square-on, 0 at 90°, negative when it faces away. */
  facing: number;
  /** False while the screen faces away from the viewer. */
  visible: boolean;
  /** False until the 3D has actually run a frame — no WebGL, no rect. */
  valid: boolean;
}

export default function CameraScene({
  phase,
  screenRectRef,
  reduceMotion = false,
}: {
  phase: CameraPhase;
  /** Written every frame so scene 1 can start its photo at the LCD. */
  screenRectRef?: React.MutableRefObject<ScreenRect>;
  reduceMotion?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Progress per scene, written by the stage, read by the render loop. Refs,
  // not state — this changes 60 times a second.
  const pHook = useRef(0);
  const pBefore = useRef(0);
  const pBook = useRef(0);
  useSceneProgress("hook", (p) => (pHook.current = p));
  useSceneProgress("before", (p) => (pBefore.current = p));
  useSceneProgress("book", (p) => (pBook.current = p));

  // Phase lives in a ref too, so changing it doesn't rebuild the scene.
  const phaseRef = useRef<CameraPhase>(phase);
  phaseRef.current = phase;
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;

  useEffect(() => {
    let dead = false;
    let raf = 0;
    let onResize: (() => void) | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    const cleanups: (() => void)[] = [];
    const disposables: { dispose: () => void }[] = [];

    (async () => {
      const T: ThreeNS = await import("three");
      if (dead) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      // The accent is defined once, in CSS. --sc-accent is oklch() and three
      // can't parse that, so globals.css carries a hex mirror of it.
      const accentHex =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--sc-accent-hex")
          .trim() || "#506477";

      // MSAA on a 3× phone panel costs real milliseconds and buys almost
      // nothing at that density, and "high-performance" is a request for the
      // hungrier GPU — the wrong ask on a battery.
      const small = window.innerWidth < 820;
      const dense = (window.devicePixelRatio || 1) >= 2;
      try {
        renderer = new T.WebGLRenderer({
          canvas,
          antialias: !(small && dense),
          alpha: true,
          powerPreference: small ? "default" : "high-performance",
        });
      } catch {
        return; // no WebGL — every scene is still complete without it
      }
      if (!renderer.getContext()) return;
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;

      scene = new T.Scene();
      const view = new T.PerspectiveCamera(32, 1, 0.01, 40);

      // ── Environment ───────────────────────────────────────
      // A painted studio, cooled down to match the page background.
      const ec = document.createElement("canvas");
      ec.width = 1024;
      ec.height = 512;
      const x2 = ec.getContext("2d")!;
      const bg = x2.createLinearGradient(0, 0, 0, 512);
      bg.addColorStop(0, "#1e2128");
      bg.addColorStop(0.5, "#0d0f13");
      bg.addColorStop(1, "#050609");
      x2.fillStyle = bg;
      x2.fillRect(0, 0, 1024, 512);
      const soft = (cx: number, cy: number, r: number, col: string) => {
        const g = x2.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, col);
        g.addColorStop(1, "rgba(0,0,0,0)");
        x2.fillStyle = g;
        x2.fillRect(cx - r, cy - r, r * 2, r * 2);
      };
      soft(250, 130, 240, "rgba(255,255,255,0.95)");
      soft(770, 200, 200, "rgba(190,205,235,0.6)");
      soft(520, 430, 260, "rgba(120,150,200,0.28)");
      const et = new T.CanvasTexture(ec);
      et.mapping = T.EquirectangularReflectionMapping;
      et.colorSpace = T.SRGBColorSpace;
      const pmrem = new T.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(et).texture;
      et.dispose();
      pmrem.dispose();

      const key = new T.DirectionalLight(0xffffff, 1.6);
      key.position.set(0.6, 0.9, 0.7);
      scene.add(key);
      const rim = new T.DirectionalLight(0xa8c4ff, 1.2);
      rim.position.set(-0.8, 0.3, -0.9);
      scene.add(rim);
      const fill = new T.DirectionalLight(0x8fb2ff, 0.35);
      fill.position.set(-0.7, -0.4, 0.5);
      scene.add(fill);
      const baseKey = 1.6;
      const baseRim = 1.2;
      const baseFill = 0.35;

      // ── Geometry helpers ──────────────────────────────────
      let mobile = window.innerWidth < 820;
      const seg = (n: number) => (mobile ? Math.max(8, Math.round(n * 0.6)) : n);

      const roundedBox = (w: number, h: number, d: number, r: number) => {
        const s = new T.Shape();
        s.moveTo(-w / 2 + r, -h / 2);
        s.lineTo(w / 2 - r, -h / 2);
        s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
        s.lineTo(w / 2, h / 2 - r);
        s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
        s.lineTo(-w / 2 + r, h / 2);
        s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
        s.lineTo(-w / 2, -h / 2 + r);
        s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
        const bev = Math.min(r * 0.55, d * 0.22);
        const g = new T.ExtrudeGeometry(s, {
          depth: d - 2 * bev,
          bevelEnabled: true,
          bevelSize: bev,
          bevelThickness: bev,
          bevelSegments: mobile ? 2 : 4,
          curveSegments: mobile ? 6 : 10,
        });
        g.translate(0, 0, -(d - 2 * bev) / 2);
        g.computeVertexNormals();
        return g;
      };

      const ribbed = (r: number, h: number, ribs: number, depth: number) => {
        const n = mobile ? Math.round(ribs * 0.6) : ribs;
        const g = new T.CylinderGeometry(r, r, h, n * 2, 1, false);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const px = pos.getX(i);
          const pz = pos.getZ(i);
          if (Math.hypot(px, pz) < 1e-5) continue;
          const a = Math.atan2(pz, px);
          const s = 1 + depth * Math.sign(Math.sin(a * n) || 1);
          pos.setX(i, px * s);
          pos.setZ(i, pz * s);
        }
        g.computeVertexNormals();
        g.rotateX(Math.PI / 2);
        return g;
      };

      const textTex = (text: string, w: number, h: number, size: number) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const g = c.getContext("2d")!;
        g.fillStyle = "#1a1a1c";
        g.fillRect(0, 0, w, h);
        g.fillStyle = "#d8d3c9";
        g.font = `500 ${size}px "IBM Plex Mono", monospace`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(text, w / 2, h / 2 + 2);
        const t = new T.CanvasTexture(c);
        t.colorSpace = T.SRGBColorSpace;
        disposables.push(t);
        return t;
      };

      // ── Materials ─────────────────────────────────────────
      const M = (o: THREE.MeshStandardMaterialParameters) => new T.MeshStandardMaterial(o);
      const accent = new T.Color(accentHex);
      const mats = {
        body: M({ color: 0x232326, roughness: 0.48, metalness: 0.25 }),
        rubber: M({ color: 0x121213, roughness: 0.95, metalness: 0.05 }),
        steel: M({ color: 0xb9bbc0, roughness: 0.26, metalness: 1 }),
        dark: M({ color: 0x0d0d0f, roughness: 0.4, metalness: 0.7 }),
        accent: M({
          color: accent,
          roughness: 0.32,
          metalness: 0.6,
          emissive: accent,
          emissiveIntensity: 0.12,
        }),
        glass: M({ color: 0x0a1c22, roughness: 0.04, metalness: 0.6 }),
        coat: M({
          color: 0x123a4d,
          roughness: 0.08,
          metalness: 1,
          emissive: 0x0a3348,
          emissiveIntensity: 0.3,
        }),
        screen: M({
          color: 0x06070b,
          roughness: 0.12,
          metalness: 0.3,
          emissive: 0x16202e,
          emissiveIntensity: 0.4,
        }),
        sensor: M({
          color: 0x2b3f74,
          roughness: 0.18,
          metalness: 1,
          emissive: 0x1b3060,
          emissiveIntensity: 0.4,
        }),
      };

      // ── Model ─────────────────────────────────────────────
      const root = new T.Group();
      const bodyG = new T.Group();
      root.add(bodyG);

      const add = (
        parent: THREE.Object3D,
        geo: THREE.BufferGeometry,
        mat: THREE.Material,
        pos?: [number, number, number],
        rot?: [number, number, number],
      ) => {
        const m = new T.Mesh(geo, mat);
        if (pos) m.position.set(pos[0], pos[1], pos[2]);
        if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
        parent.add(m);
        return m;
      };

      // body shell
      add(bodyG, roundedBox(0.132, 0.094, 0.056, 0.011), mats.body, [0, 0, -0.031]);
      add(bodyG, roundedBox(0.128, 0.09, 0.006, 0.008), mats.dark, [0, 0, -0.061]);
      // grip
      add(bodyG, roundedBox(0.034, 0.092, 0.064, 0.015), mats.rubber, [0.055, -0.002, -0.03]);
      add(bodyG, new T.CylinderGeometry(0.019, 0.019, 0.09, seg(24), 1, false), mats.rubber, [0.064, -0.002, -0.006], [Math.PI / 2, 0, 0]);
      add(bodyG, roundedBox(0.012, 0.05, 0.056, 0.005), mats.rubber, [-0.062, 0, -0.032]);

      // viewfinder hump
      const hump = new T.Group();
      bodyG.add(hump);
      add(hump, roundedBox(0.05, 0.024, 0.05, 0.008), mats.body, [-0.004, 0.056, -0.03]);
      add(hump, roundedBox(0.036, 0.02, 0.01, 0.006), mats.rubber, [-0.004, 0.054, -0.062]);
      add(hump, roundedBox(0.028, 0.008, 0.026, 0.002), mats.dark, [-0.004, 0.071, -0.026]);
      add(hump, roundedBox(0.022, 0.003, 0.02, 0.001), mats.steel, [-0.004, 0.0755, -0.026]);

      // top plate
      add(bodyG, new T.CylinderGeometry(0.017, 0.017, 0.011, seg(32)), mats.dark, [-0.044, 0.05, -0.032]);
      add(bodyG, ribbed(0.0175, 0.011, 22, 0.03), mats.dark, [-0.044, 0.05, -0.032], [Math.PI / 2, 0, 0]);
      add(bodyG, new T.CylinderGeometry(0.013, 0.013, 0.009, seg(28)), mats.dark, [0.05, 0.05, -0.052]);
      const shutterBtn = add(bodyG, new T.CylinderGeometry(0.0065, 0.0075, 0.006, seg(24)), mats.steel, [0.056, 0.05, -0.012]);
      add(bodyG, new T.TorusGeometry(0.0105, 0.0022, 10, seg(32)), mats.accent, [0.056, 0.0475, -0.012], [Math.PI / 2, 0, 0]);
      add(bodyG, new T.CylinderGeometry(0.005, 0.005, 0.004, seg(20)), mats.dark, [0.03, 0.049, -0.02]);

      // rear screen — the hand-off point for scene 1
      const screenG = new T.Group();
      bodyG.add(screenG);
      add(screenG, roundedBox(0.082, 0.058, 0.004, 0.003), mats.dark, [-0.014, -0.004, -0.0655]);
      const screenMesh = add(
        screenG,
        new T.PlaneGeometry(0.074, 0.05),
        mats.screen,
        [-0.014, -0.004, -0.0678],
        [0, Math.PI, 0],
      );
      for (let i = 0; i < 4; i++)
        add(bodyG, new T.CylinderGeometry(0.0035, 0.0035, 0.003, seg(16)), mats.dark, [0.048, 0.026 - i * 0.018, -0.0645], [Math.PI / 2, 0, 0]);

      // mount + sensor
      add(bodyG, new T.CylinderGeometry(0.032, 0.032, 0.008, seg(48)), mats.steel, [0, 0, 0.001], [Math.PI / 2, 0, 0]);
      add(bodyG, new T.CylinderGeometry(0.0285, 0.0285, 0.03, seg(40), 1, true), mats.dark, [0, 0, -0.014], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 3; i++)
        add(bodyG, new T.BoxGeometry(0.013, 0.004, 0.0035), mats.steel, [Math.cos(i * 2.094) * 0.0295, Math.sin(i * 2.094) * 0.0295, 0.0035], [0, 0, i * 2.094 + Math.PI / 2]);
      add(bodyG, new T.CylinderGeometry(0.0035, 0.0035, 0.004, seg(16)), mats.accent, [0, 0.0355, 0.001], [Math.PI / 2, 0, 0]);
      add(bodyG, new T.BoxGeometry(0.036, 0.024, 0.0016), mats.sensor, [0, 0, -0.028]);
      add(bodyG, roundedBox(0.046, 0.034, 0.002, 0.002), mats.dark, [0, 0, -0.0295]);

      // wordmark — the one piece of branding on the object, and it stays
      const markTex = textTex("saycheeeeeze", 512, 92, 52);
      const markMesh = new T.Mesh(
        new T.PlaneGeometry(0.05, 0.009),
        new T.MeshStandardMaterial({ map: markTex, roughness: 0.6, metalness: 0.1 }),
      );
      markMesh.position.set(-0.046, 0.028, 0.0002);
      bodyG.add(markMesh);

      // base + strap lugs
      add(bodyG, new T.CylinderGeometry(0.008, 0.008, 0.003, seg(20)), mats.steel, [0, -0.0475, -0.028]);
      for (const sx of [-1, 1])
        add(bodyG, new T.TorusGeometry(0.005, 0.0016, 8, seg(20)), mats.steel, [sx * 0.068, 0.03, -0.03], [0, Math.PI / 2, 0]);

      // ── Lens ──────────────────────────────────────────────
      const lens = new T.Group();
      root.add(lens);
      add(lens, new T.CylinderGeometry(0.0315, 0.0315, 0.007, seg(48)), mats.steel, [0, 0, 0.004], [Math.PI / 2, 0, 0]);
      add(lens, new T.CylinderGeometry(0.036, 0.0345, 0.024, seg(48)), mats.body, [0, 0, 0.019], [Math.PI / 2, 0, 0]);
      add(lens, new T.TorusGeometry(0.0362, 0.0018, 8, seg(48)), mats.accent, [0, 0, 0.029]);
      add(lens, ribbed(0.0375, 0.026, 34, 0.022), mats.dark, [0, 0, 0.045]);
      add(lens, new T.CylinderGeometry(0.0365, 0.0365, 0.012, seg(48)), mats.body, [0, 0, 0.064], [Math.PI / 2, 0, 0]);
      add(lens, ribbed(0.0355, 0.03, 40, 0.02), mats.dark, [0, 0, 0.086]);
      add(lens, new T.CylinderGeometry(0.0335, 0.0325, 0.026, seg(48)), mats.body, [0, 0, 0.113], [Math.PI / 2, 0, 0]);
      add(lens, new T.CylinderGeometry(0.0345, 0.0345, 0.008, seg(48)), mats.steel, [0, 0, 0.128], [Math.PI / 2, 0, 0]);
      const glassEl = add(
        lens,
        new T.SphereGeometry(0.031, seg(48), seg(24), 0, Math.PI * 2, 0, Math.PI * 0.42),
        mats.glass,
        [0, 0, 0.108],
        [Math.PI / 2, 0, 0],
      );
      glassEl.scale.set(1, 0.42, 1);
      add(lens, new T.CircleGeometry(0.0295, seg(48)), mats.coat, [0, 0, 0.1245]);

      // iris — kept for exactly one snap, in scene 3
      const iris = new T.Group();
      iris.position.z = 0.058;
      lens.add(iris);
      const blades: THREE.Mesh[] = [];
      const bladeGeo = new T.BoxGeometry(0.03, 0.014, 0.0007);
      bladeGeo.translate(-0.015, 0, 0);
      for (let i = 0; i < 9; i++) {
        const pivot = new T.Object3D();
        pivot.rotation.z = (i / 9) * Math.PI * 2;
        iris.add(pivot);
        const b = new T.Mesh(bladeGeo, mats.dark);
        b.position.set(0.027, 0, i * 0.00035 - 0.0014);
        pivot.add(b);
        blades.push(b);
      }

      scene.add(root);

      // ── Framing ───────────────────────────────────────────
      // A stand-in for the model's silhouette, used by the fit solver below.
      //
      // The obvious choice — the eight corners of one bounding box round the
      // whole model — is far too loose for this shape. A long lens on a small
      // body means the box is mostly empty air, so the solver over-estimates
      // the width by about half, and because the box's corners swing further
      // than the object does, the framing visibly pulses as the body turns:
      // measured across scene 1, the camera breathed between 60% and 79% of
      // the screen width.
      //
      // So: take the eight corners of each *mesh's* own box — a union of small
      // boxes rather than one big one — and reduce them to the extreme point in
      // each of 64 evenly spread directions. Twenty points that bound the
      // object closely from any angle. Same measurement: a steady 74–86%.
      root.updateMatrixWorld(true);
      const candidates: THREE.Vector3[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.geometry) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!;
        for (const bx of [b.min.x, b.max.x])
          for (const by of [b.min.y, b.max.y])
            for (const bz of [b.min.z, b.max.z])
              candidates.push(new T.Vector3(bx, by, bz).applyMatrix4(m.matrixWorld));
      });

      const hull: THREE.Vector3[] = [];
      const taken = new Set<number>();
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let d = 0; d < 64; d++) {
        // Fibonacci sphere — even coverage without clustering at the poles.
        const dy = 1 - (d / 63) * 2;
        const rr = Math.sqrt(Math.max(0, 1 - dy * dy));
        const th = golden * d;
        const dx = Math.cos(th) * rr;
        const dz = Math.sin(th) * rr;
        let best = -Infinity;
        let bi = 0;
        for (let i = 0; i < candidates.length; i++) {
          const dot = candidates[i].x * dx + candidates[i].y * dy + candidates[i].z * dz;
          if (dot > best) {
            best = dot;
            bi = i;
          }
        }
        if (taken.has(bi)) continue;
        taken.add(bi);
        hull.push(candidates[bi]);
      }

      // ── Resize ────────────────────────────────────────────
      // A ResizeObserver on the canvas, not a window resize listener. On a
      // phone the container changes size when the URL bar collapses, and that
      // does not reliably fire `resize` — iOS in particular fires it late or
      // not at all mid-scroll. A stale aspect stretches the render *and* moves
      // the projected screen rect, so the photograph in scene 1 starts in the
      // wrong place. The observer sees the box change whatever caused it.
      let idleFrames = 0;
      let viewW = 1;
      let viewH = 1;
      const resize = () => {
        if (!renderer) return;
        const w = canvas.clientWidth || window.innerWidth;
        const h = canvas.clientHeight || window.innerHeight;
        if (w < 1 || h < 1) return;
        if (w === viewW && h === viewH) return;
        idleFrames = 0; // force a redraw after a resize or orientation change
        viewW = w;
        viewH = h;
        mobile = w < 820;
        // 1.5 cap on mobile: above that the fill cost stops buying anything
        // you can see on a 5" screen.
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
        renderer.setSize(w, h, false);
        view.aspect = w / h;
        // A longer virtual lens on mobile. The old 42° at close radius is what
        // turned the camera into an unreadable blob.
        view.fov = mobile ? 30 : 34;
        view.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      onResize = () => ro.disconnect();
      resize();

      // Losing the context on a backgrounded tab is normal on mobile. Without
      // this the canvas stays blank for the rest of the session; with it, the
      // page degrades to the no-WebGL path, which is complete on its own.
      const onLost = (e: Event) => {
        e.preventDefault();
        canvas.style.opacity = "0";
        if (screenRectRef?.current) screenRectRef.current.valid = false;
      };
      canvas.addEventListener("webglcontextlost", onLost);
      cleanups.push(() => canvas.removeEventListener("webglcontextlost", onLost));

      // ── Screen-rect projection ────────────────────────────
      // Four corners of the LCD, projected to viewport percentages, so the DOM
      // image in scene 1 can start exactly where the screen is.
      const corners = [
        new T.Vector3(-0.037, -0.025, 0),
        new T.Vector3(0.037, -0.025, 0),
        new T.Vector3(0.037, 0.025, 0),
        new T.Vector3(-0.037, 0.025, 0),
      ];
      const tmp = new T.Vector3();
      const screenNormal = new T.Vector3();
      const toView = new T.Vector3();
      const screenPos = new T.Vector3();
      // Projected corners in *pixels*. Pixels, not percentages: a percentage of
      // the width and a percentage of the height are different lengths, so edge
      // lengths and angles measured in mixed units are meaningless.
      const proj = [0, 0, 0, 0].map(() => ({ x: 0, y: 0 }));
      const len = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(b.x - a.x, b.y - a.y);

      const updateScreenRect = () => {
        const out = screenRectRef?.current;
        if (!out) return;

        // `project` reads camera.matrixWorldInverse, which is normally only
        // refreshed inside renderer.render() — and this runs before the draw.
        // The old version therefore projected through last frame's camera,
        // which during the 140° sweep of scene 1 is a visible offset.
        // placeView() has already inverted the matrix for this frame; the
        // screen's own world matrix still needs updating.
        screenMesh.updateWorldMatrix(true, false);

        for (let i = 0; i < corners.length; i++) {
          tmp.copy(corners[i]).applyMatrix4(screenMesh.matrixWorld).project(view);
          proj[i].x = (tmp.x * 0.5 + 0.5) * viewW;
          proj[i].y = (-tmp.y * 0.5 + 0.5) * viewH;
        }

        // Centre of the quad, and the mean of each opposing pair of edges.
        // For a mildly foreshortened rectangle this is the upright box that
        // sits on it — unlike the bounding box, which grows with every degree
        // of roll and every degree off-axis.
        const cx = (proj[0].x + proj[1].x + proj[2].x + proj[3].x) / 4;
        const cy = (proj[0].y + proj[1].y + proj[2].y + proj[3].y) / 4;
        const wPx = (len(proj[0], proj[1]) + len(proj[3], proj[2])) / 2;
        const hPx = (len(proj[0], proj[3]) + len(proj[1], proj[2])) / 2;

        // Roll, from the mean horizontal edge. Folded into ±90° so the plane's
        // Y-flip can't report the box upside down.
        let rot =
          (Math.atan2(
            proj[2].y - proj[3].y + (proj[1].y - proj[0].y),
            proj[2].x - proj[3].x + (proj[1].x - proj[0].x),
          ) *
            180) /
          Math.PI;
        while (rot > 90) rot -= 180;
        while (rot < -90) rot += 180;

        // The plane's outward normal is its local +z; it is the *mesh's own*
        // matrix that carries the Y-flip, so transforming -z gave the inward
        // normal and inverted the test. Nothing read `visible` before, so this
        // never showed up.
        screenNormal.set(0, 0, 1).transformDirection(screenMesh.matrixWorld);
        toView.copy(view.position).sub(screenMesh.getWorldPosition(screenPos)).normalize();

        out.facing = screenNormal.dot(toView);
        out.visible = out.facing > 0.1;
        out.rot = rot;
        out.w = (wPx / viewW) * 100;
        out.h = (hPx / viewH) * 100;
        out.x = ((cx - wPx / 2) / viewW) * 100;
        out.y = ((cy - hPx / 2) / viewH) * 100;
        out.valid = true;
      };

      // ── Choreography ──────────────────────────────────────
      // Every constant below is local to one scene, so scenes can change
      // length without any of this moving.
      const HOOK: Record<string, Stop[]> = {
        radius: [[0, 0.46], [0.62, 0.42], [1, 0.4]],
        theta: [[0, 0.72], [0.62, 3.05], [1, 3.14]],
        phi: [[0, 1.5], [1, 1.55]],
      };
      const BEFORE: Record<string, Stop[]> = {
        radius: [[0, 0.62], [0.5, 0.56], [1, 0.6]],
        theta: [[0, 0.95], [1, 1.3]],
        phi: [[0, 1.46], [1, 1.52]],
      };
      const BOOK: Record<string, Stop[]> = {
        radius: [[0, 0.82], [1, 0.74]],
        theta: [[0, 0.4], [1, 0.04]],
        phi: [[0, 1.56], [1, 1.56]],
      };

      // Reused every frame. Allocating vectors inside the loop hands the GC a
      // few hundred objects a second for no reason.
      const vLook = new T.Vector3();
      const vRight = new T.Vector3();
      const vUp = new T.Vector3();

      const clock = new T.Clock();
      let sp = 0; // spring position
      let sv = 0; // spring velocity
      let lastPhase: CameraPhase = null;

      const frame = () => {
        if (!renderer || !scene) return;
        const dt = Math.min(clock.getDelta(), 1 / 30);
        const t = clock.getElapsedTime();
        const ph = phaseRef.current;
        const reduce = reduceRef.current;

        if (ph === null) {
          if (lastPhase !== null) {
            canvas.style.opacity = "0";
            lastPhase = null;
          }
          return; // nothing to draw, and no GPU work while it isn't visible
        }
        if (lastPhase !== ph) {
          canvas.style.opacity = "1";
          // Jump the spring on a phase change so it doesn't sweep across.
          sp = ph === "hook" ? pHook.current : ph === "before" ? pBefore.current : pBook.current;
          sv = 0;
          lastPhase = ph;
          idleFrames = 0;
        }

        const target = ph === "hook" ? pHook.current : ph === "before" ? pBefore.current : pBook.current;

        // Critically damped spring rather than a fixed lerp: the settle reads
        // as weight instead of as an easing function.
        if (reduce) {
          sp = target;
          sv = 0;
        } else {
          const k = 150;
          const d = 24;
          sv += (k * (target - sp) - d * sv) * dt;
          sp += sv * dt;
        }

        const p = sp;
        const set = ph === "hook" ? HOOK : ph === "before" ? BEFORE : BOOK;
        const tr = (s: Stop[]) => track(p, s);

        const bob = reduce ? 0 : Math.sin(t * 0.55) * 0.004;

        // The object's own transform has to be settled before the framing
        // solver runs, because scale and roll both change its silhouette.
        // Velocity tilt: leaning very slightly into the scroll direction is
        // what makes the object feel like it has mass.
        root.rotation.z = reduce ? 0 : Math.max(-0.05, Math.min(0.05, sv * 0.012));
        root.position.y = bob * 0.5;
        root.scale.setScalar(ph === "hook" ? 1 : ph === "before" ? 0.92 : 0.95);
        root.updateMatrixWorld(true);

        const theta = tr(set.theta);
        const phi = tr(set.phi);

        // The model sits in the upper band on mobile, so the copy below it
        // never needs to overlap. On desktop it holds one side for the whole
        // page — the old version flipped left/right on every pane, which is a
        // large part of why it read as a template.
        const offY = mobile ? 0.055 : 0.02;
        const offX = mobile ? 0 : -0.055;
        const look = vLook.set(-offX * 0.9, -offY * 0.9, 0);

        const placeView = (r: number) => {
          view.position.set(
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi) + bob,
            r * Math.sin(phi) * Math.cos(theta),
          );
          view.lookAt(look);
          // lookAt leaves matrixWorld holding the *previous* rotation, so the
          // basis vectors below were a frame stale — the framing offset was
          // being applied along last frame's right/up.
          view.updateMatrixWorld(true);
          view.position.add(vRight.setFromMatrixColumn(view.matrixWorld, 0).multiplyScalar(offX * 0.62));
          view.position.add(vUp.setFromMatrixColumn(view.matrixWorld, 1).multiplyScalar(offY * 0.62));
          view.lookAt(look);
          view.updateMatrixWorld(true);
          view.matrixWorldInverse.copy(view.matrixWorld).invert();
        };

        /**
         * How far outside the safe frame the model currently reaches, as a
         * multiplier on the distance. 1 means it exactly touches the margin.
         *
         * The old code framed the camera by hand — a 1.16 radius multiplier on
         * mobile and a 0.34 floor — which is a guess that only holds for one
         * aspect ratio. Measured on a 390×844 phone, the body actually covered
         * between 146% and 215% of the screen width across scene 1: cut off at
         * both edges, at every point in the scene. This measures the real
         * silhouette instead, so it holds on any phone, in either orientation,
         * at every angle in the choreography.
         */
        const overflow = () => {
          let mx = 0;
          let my = 0;
          for (const c of hull) {
            tmp.copy(c).applyMatrix4(root.matrixWorld).project(view);
            // Behind the near plane the projection flips sign; treat it as a
            // hard overflow rather than trusting the number.
            if (tmp.z > 1) return 2;
            mx = Math.max(mx, Math.abs(tmp.x));
            my = Math.max(my, Math.abs(tmp.y));
          }
          return Math.max(mx / FIT_X, my / FIT_Y);
        };

        // Never closer than 0.34: past that the body fills the frame and stops
        // reading as a camera.
        let radius = Math.max(0.34, tr(set.radius));
        placeView(radius);
        // Two Newton steps. Screen size is very close to inversely proportional
        // to distance, so the first step lands within a percent and the second
        // removes the rest; both are smooth functions of the scroll, so this
        // cannot introduce jitter.
        for (let i = 0; i < 2; i++) {
          const over = overflow();
          if (over <= 1.001) break;
          radius *= over;
          placeView(radius);
        }

        let flash = 0;

        if (ph === "hook") {
          // The screen wakes as the back comes round.
          const wake = ramp(p, 0.34, 0.58);
          mats.screen.emissiveIntensity = 0.4 + wake * 2.4;
          for (const b of blades) b.rotation.z = 0.98;
        } else if (ph === "before") {
          // One snap. Asymmetric: 90ms closed, then it opens again.
          const open = track(p, [
            [0.5, 0.95],
            [0.53, 0.06],
            [0.57, 0.95],
          ]);
          for (const b of blades) b.rotation.z = 0.06 + open * 0.92;
          flash = track(p, [
            [0.524, 0],
            [0.532, 1],
            [0.556, 0],
          ]);
          mats.screen.emissiveIntensity = 0.5 + flash * 1.6;
        } else {
          // Book: dim, far, lens toward the viewer.
          mats.screen.emissiveIntensity = 0.25;
          for (const b of blades) b.rotation.z = 0.98;
        }

        mats.sensor.emissiveIntensity = 0.4 + flash * 4.5;
        mats.accent.emissiveIntensity = 0.12 + flash * 1.4;
        shutterBtn.position.y = 0.05 - flash * 0.0025;

        const dim = ph === "book" ? 0.55 : 1;
        key.intensity = baseKey * dim;
        rim.intensity = baseRim * dim;
        fill.intensity = baseFill * dim;

        // Only scene 1 hands a photograph over, so only scene 1 pays for it.
        if (ph === "hook") updateScreenRect();

        // Skip the draw once everything has settled and nothing is animating.
        // Under reduced motion there's no idle bob, so once the spring settles
        // there is genuinely nothing left to draw and we stop. With motion on,
        // the bob advances every frame, so we keep drawing — the real saving is
        // the four scenes with no phase at all, where the loop has already
        // returned above without touching the GPU.
        const settled =
          Math.abs(target - sp) < 0.0006 && Math.abs(sv) < 0.0006 && flash < 0.001;
        if (reduce && settled) {
          if (idleFrames++ > 2) return;
        } else {
          idleFrames = 0;
        }

        renderer.render(scene, view);
      };

      const loop = () => {
        if (dead) return;
        raf = requestAnimationFrame(loop);
        frame();
      };
      loop();
    })();

    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      onResize?.();
      for (const c of cleanups) c();
      // Locale switches remount this component; free the GPU memory.
      if (scene) {
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
          else m?.dispose();
        });
        // material.dispose() does not touch the textures the material points
        // at, and the PMREM render target is not owned by any material at all.
        // Both leaked on every locale switch.
        scene.environment?.dispose();
      }
      for (const d of disposables) d.dispose();
      renderer?.dispose();
    };
    // Built once. Phase and progress arrive through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full opacity-0 transition-opacity duration-500"
      />
    </div>
  );
}
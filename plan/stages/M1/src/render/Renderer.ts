import * as THREE from 'three';
import { CONFIG } from '../config';
import { yawForward, type Level } from '../game/grid';
import type { World } from '../game/World';
import { buildLevelMeshes } from './buildLevelMesh';
import { createRevealUniforms, type RevealUniforms } from './revealMaterial';

/**
 * Owns the three.js renderer, scene and first-person camera. Reads World state each frame;
 * never mutates game state.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly uniforms: RevealUniforms = createRevealUniforms();
  /** Smoothed render frames per second (debug panel). */
  fps = 0;
  private levelGroup: THREE.Group | null = null;
  private width = 0;
  private height = 0;
  private lastFrameMs = 0;
  private shakeUntilS = 0;
  private shakeAmp = 0;

  constructor(private readonly container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(1);
    this.gl.setClearColor(0x000000, 1);
    this.gl.domElement.className = 'stage-canvas';
    container.appendChild(this.gl.domElement);
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV_DEG, 1, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    // The camera is added to the scene so objects parented to it (the jumpscare in M5) are rendered.
    this.scene.add(this.camera);
  }

  loadLevel(level: Level): void {
    if (this.levelGroup) {
      this.scene.remove(this.levelGroup);
      disposeTree(this.levelGroup);
    }
    this.levelGroup = buildLevelMeshes(level, this.uniforms);
    this.scene.add(this.levelGroup);
  }

  /** Camera shake for jumpscares. */
  shake(amplitude: number, durationS: number, clockS: number): void {
    this.shakeAmp = amplitude;
    this.shakeUntilS = clockS + durationS;
  }

  render(world: World, clockS: number, nowMs: number): void {
    if (this.lastFrameMs > 0) {
      const inst = 1000 / Math.max(nowMs - this.lastFrameMs, 1);
      this.fps = this.fps === 0 ? inst : this.fps * 0.9 + inst * 0.1;
    }
    this.lastFrameMs = nowMs;
    if (!this.syncSize()) return;

    const p = world.player;
    const bob = Math.sin(p.bobPhase) * 0.035;
    this.camera.position.set(p.x, CONFIG.EYE_HEIGHT + bob, p.z);
    this.camera.rotation.set(0, p.yaw, 0);
    if (clockS < this.shakeUntilS) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp;
    }

    const u = this.uniforms;
    u.uTime.value = clockS;
    world.pulses.writeUniforms(u);
    const beam = world.beam;
    if (beam) {
      const f = yawForward(p.yaw);
      u.uBeamOn.value = 1;
      u.uBeamOrigin.value.copy(this.camera.position);
      u.uBeamDir.value.set(f.x, 0, f.z).normalize();
      u.uBeamCos.value = Math.cos(beam.halfAngleRad);
      u.uBeamRange.value = beam.range;
      u.uBeamStrength.value = beam.strength;
    } else {
      u.uBeamOn.value = 0;
    }
    this.gl.render(this.scene, this.camera);
  }

  /**
   * Keeps the drawing buffer equal to the container size. Checked EVERY frame because the page can
   * start with a 0x0 window (hidden tab/pane). Returns false when there is nothing to draw into.
   */
  private syncSize(): boolean {
    const w = Math.floor(this.container.clientWidth * CONFIG.RENDER_SCALE);
    const h = Math.floor(this.container.clientHeight * CONFIG.RENDER_SCALE);
    if (w <= 0 || h <= 0) return false;
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.gl.setSize(w, h, false); // false: CSS (.stage-canvas) stretches the canvas to the container
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    return true;
  }
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
}

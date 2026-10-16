import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Level } from '../game/grid';
import type { World } from '../game/World';
import { Afterimages } from './Afterimages';
import { buildLevelMeshes } from './buildLevelMesh';
import { CaveLife } from './CaveLife';
import { EyeGlow } from './EyeGlow';
import { FireflyJarView } from './FireflyJarView';
import { GuideTrail } from './GuideTrail';
import { NearDust } from './NearDust';
import { PotsView } from './Pots';
import { createRevealUniforms, type RevealUniforms } from './revealMaterial';

/**
 * Owns the three.js renderer, scene, first-person camera and afterimages (the jumpscare is a video, ui/JumpscareVideo).
 * Reads World state each frame; never mutates game state.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly uniforms: RevealUniforms = createRevealUniforms();
  /** Red monster silhouettes left behind by pulses and the jar light (M4+). */
  readonly afterimages: Afterimages;
  /** Permanent scratched red wall arrows toward the exit. */
  private readonly guide: GuideTrail;
  /** Red eyes in the dark. */
  private readonly eyes: EyeGlow;
  /** Dust, drips, bats and remains. */
  readonly caveLife: CaveLife;
  private readonly nearDust: NearDust;
  /** Clay pots on the floor (whole or shattered). */
  private readonly pots: PotsView;
  /** Smoothed render frames per second (debug panel). */
  fps = 0;
  /** Drawing-buffer size relative to the window. Starts at CONFIG.RENDER_SCALE; App lowers it when fps drops. */
  scale: number = CONFIG.RENDER_SCALE;
  private levelGroup: THREE.Group | null = null;
  private width = 0;
  private height = 0;
  private lastFrameMs = 0;
  private shakeUntilS = 0;
  private shakeAmp = 0;
  /** The firefly jar in the left hand: its own pass after the cave (cleared depth). */
  private readonly jarScene = new THREE.Scene();
  private readonly jar = new FireflyJarView(this.jarScene);
  private readonly jarPos = new THREE.Vector3();
  private lastYaw = 0;
  /** Game-clock time the jar was first raised (null = play has not started). */
  private jarIntroStartS: number | null = null;

  constructor(private readonly container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(1);
    this.gl.setClearColor(0x000000, 1);
    this.gl.domElement.className = 'stage-canvas';
    container.appendChild(this.gl.domElement);
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV_DEG, 1, CONFIG.CAMERA_NEAR_M, 120);
    this.camera.rotation.order = 'YXZ';
    this.afterimages = new Afterimages(this.scene);
    this.guide = new GuideTrail(this.scene, this.uniforms);
    this.eyes = new EyeGlow(this.scene);
    this.caveLife = new CaveLife(this.scene, this.uniforms);
    this.nearDust = new NearDust(this.scene, this.uniforms);
    this.pots = new PotsView(this.scene, this.uniforms);
  }

  loadLevel(level: Level): void {
    if (this.levelGroup) {
      this.scene.remove(this.levelGroup);
      disposeTree(this.levelGroup);
    }
    const built = buildLevelMeshes(level, this.uniforms);
    this.levelGroup = built.group;
    this.scene.add(this.levelGroup);
    this.caveLife.setLevel(level, built.field);
    this.pots.setLevel(level, built.field);
    this.afterimages.clear();
    this.eyes.clear();
    this.guide.setLevel(level, this.levelGroup);
  }

  /** Raises the jar on first play; it stays held from then on. Later calls don't restart the lift. */
  showJarOnce(clockS: number): void {
    this.jarIntroStartS ??= clockS;
  }

  /** 0..1: raise into view once, then keep holding it. */
  private jarPresence(clockS: number): number {
    if (this.jarIntroStartS === null) return 0;
    const t = clockS - this.jarIntroStartS;
    const k = Math.min(Math.max(t / CONFIG.JAR_INTRO_MOVE_S, 0), 1);
    return k * k * (3 - 2 * k);
  }

  /** Camera shake (the Stalker's face arriving). */
  shake(amplitude: number, durationS: number, clockS: number): void {
    this.shakeAmp = amplitude;
    this.shakeUntilS = clockS + durationS;
  }

  render(world: World, clockS: number, nowMs: number): void {
    const dtS = this.lastFrameMs > 0 ? Math.min((nowMs - this.lastFrameMs) / 1000, CONFIG.MAX_DT_S) : 0;
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

    this.afterimages.update(clockS);
    this.eyes.update(world.eyes(), clockS);
    this.caveLife.update(clockS);
    this.pots.update(world.pots.list);
    const u = this.uniforms;
    u.uTime.value = clockS;
    world.pulses.writeUniforms(u);
    // The jar follows the camera; its light on the rock comes from where it is held.
    const turnRate = dtS > 0 ? (p.yaw - this.lastYaw) / dtS : 0;
    this.lastYaw = p.yaw;
    const jar = world.jar;
    this.jar.root.position.copy(this.camera.position);
    this.jar.root.quaternion.copy(this.camera.quaternion);
    const presence = this.jarPresence(clockS);
    this.jar.update(dtS, clockS, jar.glow, jar.excitement, p.bobPhase, turnRate, presence);
    this.jar.root.updateMatrixWorld(true);
    u.uJarPos.value.copy(this.jar.worldCenter(this.jarPos));
    u.uJarRadius.value = jar.radius;
    u.uJarStrength.value = jar.lit ? jar.glow * CONFIG.JAR_LIGHT_STRENGTH * (1 - CONFIG.JAR_FLICKER + CONFIG.JAR_FLICKER * this.jar.blink * 2) : 0;
    this.nearDust.update(this.camera, this.height);
    this.gl.render(this.scene, this.camera);
    if (presence > 0) {
      this.gl.autoClear = false;
      this.gl.clearDepth();
      this.gl.render(this.jarScene, this.camera);
      this.gl.autoClear = true;
    }
  }

  /**
   * Keeps the drawing buffer equal to the container size. Checked EVERY frame because the page can
   * start with a 0x0 window (hidden tab/pane). Returns false when there is nothing to draw into.
   */
  private syncSize(): boolean {
    const w = Math.floor(this.container.clientWidth * this.scale);
    const h = Math.floor(this.container.clientHeight * this.scale);
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

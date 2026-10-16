import * as THREE from 'three';
import { CONFIG } from '../config';
import { yawForward, type Level } from '../game/grid';
import type { World } from '../game/World';
import { Afterimages } from './Afterimages';
import type { Creature } from '../game/World';
import { buildLevelMeshes, COLORS } from './buildLevelMesh';
import { CaveLife } from './CaveLife';
import { EyeGlow } from './EyeGlow';
import { GuideTrail } from './GuideTrail';
import { PotsView } from './Pots';
import { createEchoMaterial, createMonsterModel, setPose, type HollowFigure } from './monsterModel';
import { artworkTexture } from './hollowArtwork';
import { createRevealUniforms, type RevealUniforms } from './revealMaterial';

/**
 * Owns the three.js renderer, scene, first-person camera, afterimages and jumpscare.
 * Reads World state each frame; never mutates game state.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly uniforms: RevealUniforms = createRevealUniforms();
  /** Red monster silhouettes left behind by pulses and the beam (M4+). */
  readonly afterimages: Afterimages;
  /** Gold floor arrows toward the exit. */
  private readonly guide: GuideTrail;
  /** Red eyes in the dark. */
  private readonly eyes: EyeGlow;
  /** Dust, drips, bats and remains. */
  readonly caveLife: CaveLife;
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
  private jumpscare: { fig: HollowFigure; body: THREE.ShaderMaterial; eyes: THREE.MeshBasicMaterial; startS: number; hit: boolean; stare: boolean } | null = null;
  /**
   * The jumpscare is drawn in a second pass after clearing depth, so it is never hidden by rock (it is
   * wider than the tunnel) yet its own parts still hide each other. jumpRoot follows the camera.
   */
  private readonly jumpScene = new THREE.Scene();
  private readonly jumpRoot = new THREE.Group();

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
    this.pots = new PotsView(this.scene, this.uniforms);
    this.jumpScene.add(this.jumpRoot);
    artworkTexture('lunge'); // Preload the catch portrait during the title/calibration screens.
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
    this.guide.setLevel(level);
    this.hideJumpscare();
  }

  /**
   * The catch: it leaps out of the dark at your face, jaw open (or the pale Hush), drawn over
   * everything. App cuts to black a moment later.
   */
  showJumpscare(clockS: number, who: Creature = 'hollow'): void {
    if (!this.jumpscare) {
      const body = createEchoMaterial(COLORS.monster, 'solid');
      const eyes = new THREE.MeshBasicMaterial({ color: COLORS.jumpscareEyes });
      // The model faces +z and the camera looks down -z, so unrotated it faces the player.
      const fig = createMonsterModel(body, eyes, { pose: 'lunge', mirror: false });
      this.jumpRoot.add(fig.group);
      this.jumpscare = { fig, body, eyes, startS: clockS, hit: false, stare: false };
    }
    this.jumpscare.startS = clockS;
    this.jumpscare.hit = false;
    this.jumpscare.stare = false;
    setPose(this.jumpscare.fig, { pose: 'lunge', mirror: false }, who);
    this.jumpscare.body.transparent = this.jumpscare.fig.artwork;
    this.jumpscare.body.depthWrite = !this.jumpscare.fig.artwork;
    this.jumpscare.body.uniforms.uColor.value.setHex(who === 'hush' ? COLORS.hush : COLORS.monster);
    this.jumpscare.eyes.color.setHex(who === 'hush' ? 0x000000 : COLORS.jumpscareEyes);
    this.placeJumpscare(clockS);
    this.jumpscare.fig.group.visible = true;
  }

  /**
   * The Stalker's stare: the catch face appears right in front of you and holds there, breathing, not
   * leaping. App hides it when the Stalker turns away, or turns it into the real catch.
   */
  showStare(clockS: number): void {
    this.showJumpscare(clockS);
    const j = this.jumpscare!;
    j.stare = true;
    j.hit = true;
    this.shake(0.06, 0.35, clockS);
  }

  hideJumpscare(): void {
    if (this.jumpscare) this.jumpscare.fig.group.visible = false;
  }

  /** Leap: from JUMPSCARE_FROM_M to JUMPSCARE_TO_M ahead with an ease-in (it accelerates at you), then shake on impact. */
  private placeJumpscare(clockS: number): void {
    const j = this.jumpscare;
    if (!j || !j.fig.group.visible) return;
    // The stare holds still part-way into the leap, swaying a little as it breathes.
    const t = j.stare
      ? CONFIG.STALKER_STARE_LEAP_T * (1 + 0.015 * Math.sin((clockS - j.startS) * 2.1))
      : Math.min(Math.max((clockS - j.startS) / (CONFIG.JUMPSCARE_LEAP_MS / 1000), 0), 1);
    const dist = CONFIG.JUMPSCARE_FROM_M + (CONFIG.JUMPSCARE_TO_M - CONFIG.JUMPSCARE_FROM_M) * t * t;
    // The lunge pose's skull is 0.34 m in front of its feet and 1.72 m up: put it at eye level, `dist` ahead.
    if (j.fig.artwork) {
      // The face fills the viewport on impact while its eyes and mouth remain inside the frame.
      const impactHeight = 2 * CONFIG.JUMPSCARE_TO_M * Math.tan(CONFIG.CAMERA_FOV_DEG * Math.PI / 360)
        * CONFIG.HOLLOW_CATCH_SCREEN_HEIGHT;
      const height = CONFIG.HOLLOW_CATCH_SIZE_M + (impactHeight - CONFIG.HOLLOW_CATCH_SIZE_M) * t * t;
      j.fig.group.position.set(0, -height * (1 - CONFIG.HOLLOW_CATCH_FACE_V), -dist);
      j.fig.group.scale.setScalar(height / CONFIG.HOLLOW_CATCH_SIZE_M);
    } else {
      j.fig.group.position.set(0, -1.72, -dist - 0.34);
      j.fig.group.scale.setScalar(1);
    }
    if (t >= 1 && !j.hit) {
      j.hit = true;
      this.shake(0.1, 0.5, clockS);
    }
    // After impact it flickers (random dropped frames), so the eye never gets a calm look at it.
    j.fig.body.visible = j.fig.eyes.visible = j.stare ? Math.random() > CONFIG.STALKER_STARE_FLICKER : t < 1 || Math.random() > CONFIG.JUMPSCARE_FLICKER;
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

    this.placeJumpscare(clockS);
    this.afterimages.update(clockS);
    this.eyes.update(world.eyes(), clockS);
    this.caveLife.update(clockS);
    this.pots.update(world.pots.list);
    this.guide.update(p.x, p.z);
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
    if (this.jumpscare?.fig.group.visible) {
      this.jumpRoot.position.copy(this.camera.position);
      this.jumpRoot.quaternion.copy(this.camera.quaternion);
      this.gl.autoClear = false;
      this.gl.clearDepth();
      this.gl.render(this.jumpScene, this.camera);
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

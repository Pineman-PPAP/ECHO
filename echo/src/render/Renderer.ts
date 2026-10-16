import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Level } from '../game/grid';
import type { World } from '../game/World';
import { Afterimages } from './Afterimages';
import type { Creature } from '../game/World';
import { buildLevelMeshes, COLORS } from './buildLevelMesh';
import { CaveLife } from './CaveLife';
import type { CameraPose } from './CinematicCamera';
import { EyeGlow } from './EyeGlow';
import { FireflyJarView } from './FireflyJarView';
import { GuideTrail } from './GuideTrail';
import { NearDust } from './NearDust';
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
  private jumpscare: { fig: HollowFigure; body: THREE.ShaderMaterial; eyes: THREE.MeshBasicMaterial; startS: number; hit: boolean; stare: boolean } | null = null;
  /**
   * The jumpscare is drawn in a second pass after clearing depth, so it is never hidden by rock (it is
   * wider than the tunnel) yet its own parts still hide each other. jumpRoot follows the camera.
   */
  private readonly jumpScene = new THREE.Scene();
  private readonly jumpRoot = new THREE.Group();
  /** The firefly jar in the left hand: its own pass after the cave (cleared depth), before the jumpscare. */
  private readonly jarScene = new THREE.Scene();
  private readonly jar = new FireflyJarView(this.jarScene);
  private readonly jarPos = new THREE.Vector3();
  private lastYaw = 0;
  /** Game-clock time the jar was first raised (null = play has not started). */
  private jarIntroStartS: number | null = null;
  /** Field Manual: the cinematic camera offset (null = plain first person) and the jar's close-up (0..1). */
  private cinematic: CameraPose | null = null;
  private jarOffer = 0;

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
    this.guide.setLevel(level, this.levelGroup);
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

  /** Field Manual: offset the camera from the player's eyes (null = the plain first-person view). */
  setCinematic(pose: CameraPose | null): void {
    this.cinematic = pose;
  }

  /** Field Manual: 0 = the jar is held in the left hand, 1 = brought forward for its close-up. */
  setJarOffer(offer: number): void {
    this.jarOffer = offer;
  }

  /** Camera shake for jumpscares. */
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
    let fov: number = CONFIG.CAMERA_FOV_DEG;
    const c = this.cinematic;
    if (c) {
      // Offsets are in the camera's own frame: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw).
      const yaw = p.yaw + c.yaw;
      this.camera.position.x += -Math.sin(yaw) * c.forward + Math.cos(yaw) * c.right;
      this.camera.position.y += c.up;
      this.camera.position.z += -Math.cos(yaw) * c.forward - Math.sin(yaw) * c.right;
      this.camera.rotation.set(c.pitch, yaw, c.roll);
      fov = c.fov;
    }
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (clockS < this.shakeUntilS) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp;
    }

    this.placeJumpscare(clockS);
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
    this.jar.update(dtS, clockS, jar.glow, jar.excitement, p.bobPhase, turnRate, presence, this.jarOffer);
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

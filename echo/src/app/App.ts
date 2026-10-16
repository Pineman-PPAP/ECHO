import { Sfx } from '../audio/Sfx';
import { CONFIG } from '../config';
import { dripImpacts, dripSpots, levelSeed, type DripSpot } from '../game/caveLife';
import { cellCenter } from '../game/grid';
import { guidePoint } from '../game/guide';
import { LEVELS } from '../game/levels';
import { Tutorial } from '../game/Tutorial';
import { World, type WorldEvent } from '../game/World';
import { CalibrationRunner, CONTROLS, defaultCalibration, type CalibCue, type CalibrationData } from '../input/calibration';
import { SensorError } from '../input/camera';
import { IntentBuilder } from '../input/IntentBuilder';
import { idleIntent, type PlayerIntent } from '../input/intent';
import { Sensors, type SensorFrames } from '../input/Sensors';
import { SimInput } from '../input/SimInput';
import { Renderer } from '../render/Renderer';
import { Card } from '../ui/Card';
import { DebugPanel } from '../ui/DebugPanel';
import { Hud } from '../ui/Hud';
import { JumpscareVideo } from '../ui/JumpscareVideo';
import { CALIB_ICONS } from '../ui/icons';
import { Overlays } from '../ui/Overlays';
import type { Flags } from './flags';

type State =
  | { kind: 'title' }
  | { kind: 'loading'; message: string }
  | { kind: 'error'; title: string; body: string }
  | { kind: 'calibrating'; runner: CalibrationRunner }
  | { kind: 'intro' }
  | { kind: 'playing' }
  | { kind: 'paused'; faceBackSinceMs: number | null }
  /** video: the filmed jumpscare is playing (false = it couldn't: just black); cutAtMs: when it cut to black. */
  | { kind: 'caught'; video: boolean; cut: boolean; cutAtMs: number }
  | { kind: 'gameover' }
  | { kind: 'escaped' }
  | { kind: 'victory' };

const LEVEL_HINTS: Record<string, string> = {
  listener: 'It’s blind. Every clap shows you the cave, and tells it where you are.',
  choir: 'Lean gently to sneak. Footsteps make noise, but silence draws the Hush.',
};

/** Shown when the player breaks a pot in the tutorial, where nothing can hear it yet. */
const TUTORIAL_POT_PROMPT = 'That was loud. Down here, something would have heard it. Light the floor and walk around pots.';

/** The Stalker: told to freeze when it is close, held through its stare, released when it turns away. */
const STALKER_WARN_PROMPT = 'STAND STILL. Don’t move. Don’t make a sound.';
const STALKER_STARE_PROMPT = 'Don’t move. Don’t breathe.';
const STALKER_SPARED_PROMPT = 'It turned away… Move on, and watch the floor for pots.';

/** Shown the first time the Hush appears in a level. */
const HUSH_PROMPT = 'Too quiet… something is drawn to the silence. Make a sound.';

interface Stats {
  ms: number;
  sounds: number;
}

/**
 * The application: owns every subsystem and runs the state machine + frame loop.
 *
 *  title --click--> loading --> calibrating --> intro --clap/timeout--> playing <--> paused (face lost)
 *                                  ^                                     |  |
 *                                  |  hum (new player)                   |  +--exit--> escaped --clap--> intro (next level)
 *                                  +------------- gameover <-- caught <--+                 \--last level--> victory --clap--> intro
 *
 * Menus are hands-free: CLAP = confirm, HUM = secondary action. The only mouse use is the Begin
 * button, which the browser requires before it grants camera/mic and starts audio.
 */
export class App {
  private readonly renderer: Renderer;
  private readonly card: Card;
  private readonly hud: Hud;
  private readonly overlays: Overlays;
  private readonly jumpVideo: JumpscareVideo;
  private readonly debug: DebugPanel;
  private readonly devBadge: HTMLElement;
  private readonly sim: SimInput | null;
  private sensors: Sensors | null = null;
  private audio: AudioContext | null = null;
  private sfx: Sfx | null = null;
  private calib: CalibrationData = defaultCalibration();
  private readonly intents = new IntentBuilder(this.calib);
  private world: World;
  private levelIndex: number;
  private state: State = { kind: 'title' };
  private stateSinceMs = performance.now();
  private readonly appStartMs = performance.now();
  private lastMs = this.appStartMs;
  private nextDraftMs = 0;
  private levelStartMs = 0;
  private levelStats: Stats = { ms: 0, sounds: 0 };
  private runStats: Stats = { ms: 0, sounds: 0 };
  private tutorial: Tutorial | null = null;
  /** Timed HUD line from an authored moment or the Hush's first appearance. */
  private momentPrompt: { text: string; untilMs: number } | null = null;
  private hushPrompted = false;
  private drips: DripSpot[] = [];
  private lastDripS = 0;
  private nextAttractMs = 0;
  private lowFpsSinceMs: number | null = null;

  constructor(
    root: HTMLElement,
    private readonly flags: Flags,
  ) {
    root.innerHTML = `<div id="stage"></div><div id="dev-badge" class="dev-badge" hidden></div>`;
    this.renderer = new Renderer(root.querySelector<HTMLElement>('#stage')!);
    this.hud = new Hud(root);
    this.overlays = new Overlays(root);
    this.jumpVideo = new JumpscareVideo(root);
    this.card = new Card(root);
    this.debug = new DebugPanel(root, flags.debug);
    this.devBadge = root.querySelector<HTMLElement>('#dev-badge')!;
    this.devBadge.hidden = !flags.sim;
    this.devBadge.textContent =
      'DEV SIM INPUT · arrows/WASD move · Space clap · Shift+Space click · H hum · [ ] pitch · B eyes closed · F face lost · ` debug panel';
    this.sim = flags.sim ? new SimInput() : null;
    this.levelIndex = Math.min(flags.level, LEVELS.length - 1);
    this.world = new World(LEVELS[this.levelIndex], this.levelIndex + 1);
    this.renderer.loadLevel(this.world.level);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ frame loop

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    const nowMs = performance.now();
    const dtS = Math.min((nowMs - this.lastMs) / 1000, CONFIG.MAX_DT_S);
    this.lastMs = nowMs;
    const clockS = (nowMs - this.appStartMs) / 1000;

    const frames = this.sensors ? this.sensors.update(nowMs) : null;
    const intent: PlayerIntent = this.sim
      ? this.sim.update(nowMs)
      : frames
        ? this.intents.update(nowMs, frames.face, frames.mic)
        : idleIntent();

    this.step(nowMs, dtS, clockS, intent, frames);
    this.renderer.render(this.world, clockS, nowMs);
    this.updateAudio(nowMs, clockS);
    this.updateOverlays(nowMs, intent, frames);
  };

  private step(nowMs: number, dtS: number, clockS: number, intent: PlayerIntent, frames: SensorFrames | null): void {
    const s = this.state;
    const menuReady = nowMs - this.stateSinceMs >= CONFIG.MENU_INPUT_DELAY_MS;
    const clap = intent.pulses.length > 0;
    this.attract(s.kind, nowMs, dtS, clockS);

    switch (s.kind) {
      case 'title':
        this.card.show({
          title: 'ECHO',
          body: 'You are blind in a cave. Your voice is your only light.\nThe things down here are blind too. They hunt by sound.',
          rows: CONTROLS,
          hint: this.sim ? 'DEV SIM: keyboard controls (see the badge)' : 'Headphones on · face the light · allow camera and microphone',
          button: { label: this.sim ? 'Begin (dev sim)' : 'Begin', onClick: () => this.begin() },
        });
        break;

      case 'loading':
        this.card.show({ title: 'Starting…', body: s.message });
        break;

      case 'error':
        this.card.show({ title: s.title, body: s.body, tone: 'danger', button: { label: 'Reload', onClick: () => location.reload() } });
        break;

      case 'calibrating': {
        const u = s.runner.update(nowMs, frames?.face ?? null, frames?.mic ?? null);
        for (const cue of u.cues) this.playCue(cue);
        const v = u.view;
        const done = v.step === 'done';
        this.card.show({
          kicker: done ? 'Calibrated to you' : `Step ${v.index} of ${v.total}`,
          icon: CALIB_ICONS[v.step],
          title: v.title,
          body: v.prompt,
          detail: v.why,
          rows: done ? CONTROLS : undefined,
          progress: v.progress,
          status: v.status,
          statusTone: v.statusTone,
          tone: done ? 'gold' : 'normal',
          showCamera: v.step === 'face' || v.step === 'neutral' || v.step === 'left',
        });
        this.card.drawCamera(this.sensors?.lastFace ?? null);
        if (u.finished) {
          this.applyCalibration(s.runner.data);
          this.startLevel(this.levelIndex);
        }
        break;
      }

      case 'intro': {
        const def = this.world.level.def;
        this.card.show({ title: def.name, body: def.intro.join('\n'), hint: menuReady ? this.confirmHint('begin') : '' });
        if ((menuReady && clap) || nowMs - this.stateSinceMs >= CONFIG.INTRO_AUTO_MS) this.enterPlaying(nowMs);
        break;
      }

      case 'playing': {
        this.card.hide();
        if (!intent.facePresent) {
          this.setState({ kind: 'paused', faceBackSinceMs: null });
          break;
        }
        const events = this.world.update(dtS, nowMs, clockS, intent);
        this.route(events, nowMs, clockS);
        this.tutorial?.update(dtS, intent, events);
        this.adaptQuality(nowMs);
        break;
      }

      case 'paused':
        this.card.show({
          title: 'I can’t see you',
          body: 'Come back in front of the camera.\nThe game is paused and the Hollows are frozen.',
        });
        if (intent.facePresent) {
          s.faceBackSinceMs ??= nowMs;
          if (nowMs - s.faceBackSinceMs >= CONFIG.FACE_FOUND_RESUME_MS) {
            this.intents.eyes.reset();
            this.setState({ kind: 'playing' });
          }
        } else {
          s.faceBackSinceMs = null;
        }
        break;

      case 'caught': {
        // The clip plays out (started with the thud when you were caught), then a hard cut to black
        // and silence, then the card. If it can't play, it's just the thud and black.
        this.card.hide();
        const since = nowMs - this.stateSinceMs;
        if (s.video && !s.cut && this.jumpVideo.failed) s.video = false;
        const cutDue = !s.video || this.jumpVideo.ended || since >= CONFIG.JUMPSCARE_VIDEO_MS;
        if (!s.cut && cutDue) {
          s.cut = true;
          s.cutAtMs = nowMs;
          this.jumpVideo.hide();
          this.overlays.setBlackout(true);
          if (s.video) this.sfx?.silence(true);
        }
        const overDue = s.video ? s.cut && nowMs - s.cutAtMs >= CONFIG.JUMPSCARE_VIDEO_BLACK_MS : since >= CONFIG.JUMPSCARE_MS;
        if (overDue) this.setState({ kind: 'gameover' }); // lifts the blackout and silence
        break;
      }

      case 'gameover':
        this.card.show({
          title: 'THEY FOUND YOU',
          body: statsText(this.levelStats),
          hint: menuReady ? this.confirmHint('try again') : '',
          tone: 'danger',
        });
        if (menuReady && clap) this.startLevel(this.levelIndex);
        else if (menuReady && intent.humStarted && this.sensors) this.startCalibration();
        break;

      case 'escaped':
        this.card.show({
          title: 'YOU ESCAPED',
          body: statsText(this.levelStats),
          hint: menuReady ? this.confirmHint('go deeper') : '',
          tone: 'gold',
        });
        if (menuReady && clap) this.startLevel(this.levelIndex + 1);
        break;

      case 'victory':
        this.card.show({
          title: 'YOU MADE IT OUT',
          body: `All levels cleared.\n${statsText(this.runStats)}`,
          hint: menuReady ? this.confirmHint('play again') : '',
          tone: 'gold',
        });
        if (menuReady && clap) {
          this.runStats = { ms: 0, sounds: 0 };
          this.startLevel(Math.min(1, LEVELS.length - 1)); // replays skip the tutorial
        } else if (menuReady && intent.humStarted && this.sensors) {
          this.startCalibration();
        }
        break;
    }
  }

  // ------------------------------------------------------------------ transitions

  private setState(next: State): void {
    if (this.state.kind === 'caught' && next.kind !== 'caught') {
      this.jumpVideo.hide();
      this.overlays.setBlackout(false);
      this.sfx?.silence(false);
    }
    this.state = next;
    this.stateSinceMs = performance.now();
    this.lowFpsSinceMs = null;
  }

  /** Called from the Begin button's click handler: audio MUST be created synchronously here. */
  private begin(): void {
    if (this.state.kind !== 'title') return;
    const audio = new AudioContext({ latencyHint: 'interactive' });
    void audio.resume();
    this.audio = audio;
    this.sfx = new Sfx(audio, (gateMs) => this.onGameSound(gateMs));
    this.sfx.playThrough(this.jumpVideo.video, CONFIG.JUMPSCARE_VIDEO_GAIN);
    if (this.sim) {
      this.startLevel(this.levelIndex);
      return;
    }
    this.setState({ kind: 'loading', message: 'Starting…' });
    Sensors.open(audio, (message) => {
      if (this.state.kind === 'loading') this.state.message = message;
    })
      .then((sensors) => {
        this.sensors = sensors;
        this.watchDevices(sensors.stream);
        this.card.setVideo(sensors.video);
        this.debug.setVideo(sensors.video);
        if (this.flags.skipCal) {
          this.applyCalibration(defaultCalibration());
          this.startLevel(this.levelIndex);
        } else {
          this.startCalibration();
        }
      })
      .catch((err: unknown) => this.fail(err));
  }

  /**
   * The frame loop stops while the tab is hidden, so pausing has to happen here, in the event.
   * On return the normal paused logic resumes play once the face is seen again.
   */
  private readonly onVisibility = (): void => {
    if (document.hidden) {
      if (this.state.kind === 'playing') this.setState({ kind: 'paused', faceBackSinceMs: null });
    } else {
      void this.audio?.resume();
    }
  };

  /** An unplugged camera or mic can't recover by itself: say so instead of freezing silently. */
  private watchDevices(stream: MediaStream): void {
    const watch = (track: MediaStreamTrack | undefined, title: string) =>
      track?.addEventListener('ended', () => this.setState({ kind: 'error', title, body: 'Reconnect it, then reload the page.' }));
    watch(stream.getVideoTracks()[0], 'Camera disconnected');
    watch(stream.getAudioTracks()[0], 'Microphone disconnected');
  }

  /** Lowers the render scale one step after the fps has stayed low for a while. Never raises it. */
  private adaptQuality(nowMs: number): void {
    if (this.renderer.fps >= CONFIG.ADAPTIVE_MIN_FPS || this.renderer.scale <= CONFIG.ADAPTIVE_MIN_SCALE) {
      this.lowFpsSinceMs = null;
      return;
    }
    this.lowFpsSinceMs ??= nowMs;
    if (nowMs - this.lowFpsSinceMs < CONFIG.ADAPTIVE_LOW_FPS_MS) return;
    this.renderer.scale = Math.max(CONFIG.ADAPTIVE_MIN_SCALE, this.renderer.scale - CONFIG.ADAPTIVE_SCALE_STEP);
    this.debug.log(nowMs, `render scale → ${this.renderer.scale.toFixed(2)}`);
    this.lowFpsSinceMs = null;
  }

  private fail(err: unknown): void {
    console.error('[ECHO] startup failed', err);
    if (err instanceof SensorError) {
      const text: Record<SensorError['code'], [string, string]> = {
        'no-api': ['This browser can’t use the camera', 'Open the game in Chromium at http://127.0.0.1:5173'],
        denied: [
          'Camera or microphone blocked',
          'ECHO needs the camera (to see your eyes) and the microphone (to hear you).\nAllow both via the icon in the address bar, then reload.',
        ],
        'not-found': ['No camera or microphone found', 'Connect a webcam and a microphone, then reload.'],
        busy: ['Camera or microphone busy', 'Close other apps using them (video calls, OBS), then reload.'],
        unknown: ['Could not start the camera', err.message],
      };
      const [title, body] = text[err.code];
      this.setState({ kind: 'error', title, body });
    } else {
      this.setState({
        kind: 'error',
        title: 'Could not start',
        body: `${String(err)}\nIf the face model is missing, run "npm run assets" in the echo folder.`,
      });
    }
  }

  private startCalibration(): void {
    this.levelIndex = Math.min(this.flags.level, LEVELS.length - 1);
    this.runStats = { ms: 0, sounds: 0 };
    this.setState({ kind: 'calibrating', runner: new CalibrationRunner(performance.now()) });
  }

  private applyCalibration(data: CalibrationData): void {
    this.calib = data;
    this.intents.setCalibration(data);
    this.debug.log(performance.now(), `calibrated · leftSign ${data.leftSign} · leak ${data.speakerLeak} · ${data.warnings.length} warnings`);
  }

  private startLevel(index: number): void {
    this.levelIndex = Math.max(0, Math.min(index, LEVELS.length - 1));
    this.world = new World(LEVELS[this.levelIndex], this.levelIndex + 1);
    this.renderer.loadLevel(this.world.level);
    this.tutorial = this.world.level.def.tutorial ? new Tutorial(this.world, this.sim !== null) : null;
    this.momentPrompt = null;
    this.hushPrompted = false;
    this.drips = dripSpots(this.world.level, levelSeed(this.world.level));
    if (this.sfx) {
      this.sfx.stalkerStop();
      this.sfx.clearVoices();
      this.sfx.resetDread();
      for (const m of this.world.monsters) this.sfx.addVoice(m.id);
      const e = cellCenter(this.world.level.exit);
      this.sfx.setGuidePosition(e.x, 1.3, e.z);
      this.sfx.startDrone();
    }
    this.setState({ kind: 'intro' });
  }

  private enterPlaying(nowMs: number): void {
    this.renderer.showJarOnce((nowMs - this.appStartMs) / 1000);
    this.levelStartMs = nowMs;
    this.nextDraftMs = nowMs + 1000;
    this.sfx?.confirm();
    this.setState({ kind: 'playing' });
  }

  private finishLevel(nowMs: number): void {
    this.levelStats = this.measureLevel(nowMs);
    this.runStats = {
      ms: this.runStats.ms + this.levelStats.ms,
      sounds: this.runStats.sounds + this.levelStats.sounds,
    };
    this.sfx?.confirm();
    this.setState({ kind: this.levelIndex >= LEVELS.length - 1 ? 'victory' : 'escaped' });
  }

  private measureLevel(nowMs: number): Stats {
    return {
      ms: nowMs - this.levelStartMs,
      sounds: this.world.pulsesEmitted,
    };
  }

  // ------------------------------------------------------------------ events and feedback

  private route(events: WorldEvent[], nowMs: number, clockS: number): void {
    for (const e of events) {
      switch (e.type) {
        case 'pulse':
          this.sfx?.ping(e.pulse.loudness);
          this.debug.log(nowMs, `PULSE loudness ${e.pulse.loudness.toFixed(2)} r=${e.pulse.maxRadius.toFixed(1)} m`);
          break;
        case 'footstep':
          this.sfx?.footstep(e.loudness);
          break;
        case 'heard':
          this.debug.log(nowMs, `#${e.monsterId} heard ${e.kind}`);
          break;
        case 'reveal':
          this.renderer.afterimages.spawn(e.x, e.z, e.facing, e.strength, clockS, e.who, e.pose);
          break;
        case 'caught':
          this.levelStats = this.measureLevel(nowMs);
          this.renderer.hideJumpscare(); // the Stalker's stare, if it was up
          this.sfx?.stalkerStop();
          this.sfx?.thud();
          const video = this.jumpVideo.ready;
          if (video) this.jumpVideo.play();
          this.debug.log(nowMs, e.by === 'hush' ? 'CAUGHT by the Hush' : e.by === 'stalker' ? 'CAUGHT by the Stalker' : `CAUGHT by #${e.monsterId}`);
          this.setState({ kind: 'caught', video, cut: false, cutAtMs: 0 });
          break;
        case 'alerted':
          // It heard you: a red flash and dry clicks from where it stands.
          this.overlays.flash();
          this.sfx?.alerted(e.x, e.z);
          this.debug.log(nowMs, `#${e.monsterId} HEARD you`);
          break;
        case 'hush':
          this.debug.log(nowMs, `the Hush ${e.what === 'appear' ? 'appears' : 'is driven off'}`);
          if (e.what === 'appear' && !this.hushPrompted) {
            this.hushPrompted = true;
            this.momentPrompt = { text: HUSH_PROMPT, untilMs: nowMs + CONFIG.MOMENT_PROMPT_MS };
          }
          break;
        case 'moment':
          this.debug.log(nowMs, `moment: ${e.kind}`);
          if (e.prompt) this.momentPrompt = { text: e.prompt, untilMs: nowMs + CONFIG.MOMENT_PROMPT_MS };
          if (e.kind === 'ambush') this.sfx?.sting();
          if (e.kind === 'finale') this.sfx?.roar();
          break;
        case 'bats': {
          const p = this.world.player;
          const flock = this.renderer.caveLife.spawnBats(e.x, e.z, p.x, p.z, clockS);
          const last = flock[0];
          if (last) this.sfx?.bats(last.x0, last.z0, last.x1, last.z1, last.durationS);
          this.debug.log(nowMs, 'bats!');
          break;
        }
        case 'ambient':
          if (e.cue.cue === 'fakeScrape') this.sfx?.fakeScrape(e.cue.x, e.cue.z);
          else this.sfx?.mimic(e.cue.x, e.cue.z, e.cue.loudness);
          break;
        case 'potKicked':
          this.sfx?.potShatter(e.x, e.z, e.loudness);
          this.debug.log(nowMs, `POT #${e.potId} broken, loudness ${e.loudness.toFixed(2)}`);
          if (this.tutorial) this.momentPrompt = { text: TUTORIAL_POT_PROMPT, untilMs: nowMs + CONFIG.MOMENT_PROMPT_MS };
          break;
        case 'stalker':
          this.debug.log(nowMs, `stalker: ${e.what}`);
          if (e.what === 'start') this.sfx?.stalkerStart(this.world.stalker.x, this.world.stalker.z);
          if (e.what === 'warn') {
            this.sfx?.stalkerSwell(CONFIG.STALKER_WARN_MS / 1000);
            this.momentPrompt = { text: STALKER_WARN_PROMPT, untilMs: nowMs + CONFIG.STALKER_WARN_MS };
          }
          if (e.what === 'stare') {
            this.renderer.showStare(clockS);
            this.overlays.flash();
            this.sfx?.stalkerHit();
            this.momentPrompt = { text: STALKER_STARE_PROMPT, untilMs: nowMs + CONFIG.STALKER_STARE_MS };
          }
          if (e.what === 'spared') {
            this.renderer.hideJumpscare();
            this.sfx?.stalkerExhale();
            this.momentPrompt = { text: STALKER_SPARED_PROMPT, untilMs: nowMs + CONFIG.MOMENT_PROMPT_MS };
          }
          if (e.what === 'gone') this.sfx?.stalkerStop();
          break;
        case 'exit':
          this.sfx?.stalkerStop();
          this.debug.log(nowMs, 'EXIT reached');
          this.finishLevel(nowMs);
          break;
        case 'monsterMoveStart':
        case 'monsterMoveStop':
          break;
      }
    }
  }

  private updateAudio(nowMs: number, clockS: number): void {
    const sfx = this.sfx;
    const prevDripS = this.lastDripS;
    this.lastDripS = clockS;
    if (!sfx) return;
    const p = this.world.player;
    sfx.setListener(p.x, CONFIG.EYE_HEIGHT, p.z, p.yaw);
    const w = this.world;
    const active = this.state.kind === 'playing';
    // While the Stalker comes and stares, the Hollows stand frozen and silent.
    const held = w.stalker.holding;
    for (const m of w.monsters) {
      sfx.updateVoice(m.id, m.x, m.z, active && m.moving && !held, Math.hypot(m.x - p.x, m.z - p.z), m.speed);
    }
    if (w.stalker.phase !== 'idle') {
      sfx.updateStalker(w.stalker.x, w.stalker.z, w.stalkerCloseness(), active ? w.stalker.speed : 0, w.stalker.phase === 'stare');
    }
    const hush = active ? w.hushCloseness() : 0;
    sfx.updateHeartbeat(nowMs, active ? Math.max(w.danger(), hush) : 0);
    sfx.setDroneLevel(active ? w.droneLevel() : 1);
    const ear = active ? w.earBreath() : null;
    sfx.updateEarBreath(ear?.side ?? 0, ear?.closeness ?? 0);
    if (w.hush) sfx.updateHush(w.hush.x, w.hush.z, hush);
    if (active) {
      let played = 0;
      for (const d of dripImpacts(this.drips, prevDripS, clockS)) {
        if (played < 2 && Math.hypot(d.x - p.x, d.z - p.z) <= CONFIG.DRIP_HEAR_RADIUS_M) {
          sfx.drip(d.x, d.z);
          played++;
        }
      }
    }
    if (active && nowMs >= this.nextDraftMs) {
      this.nextDraftMs = nowMs + CONFIG.DRAFT_INTERVAL_MS;
      if (!w.quiet) {
        const g = guidePoint(w.level, p.x, p.z);
        sfx.setGuidePosition(g.x, 1.3, g.z);
        sfx.draft();
      }
    }
  }

  /** Mic gating when calibration found that the speakers reach the mic. */
  private onGameSound(gateMs: number): void {
    if (this.sensors && this.calib.speakerLeak) this.sensors.mic.gate(performance.now() + gateMs);
  }

  private playCue(cue: CalibCue): void {
    if (!this.sfx) return;
    if (cue === 'testTone') this.sfx.testTone();
    else if (cue === 'ok') this.sfx.confirm();
    else this.sfx.tick();
  }

  private hudPrompt(nowMs: number): string {
    if (this.momentPrompt && nowMs < this.momentPrompt.untilMs) return this.momentPrompt.text;
    if (this.tutorial) return this.tutorial.prompt;
    if (nowMs - this.levelStartMs < CONFIG.LEVEL_HINT_MS) return LEVEL_HINTS[this.world.level.def.id] ?? '';
    return '';
  }

  /** Menus and the title screen softly pulse the maze behind the cards; monsters never hear these. */
  private attract(kind: State['kind'], nowMs: number, dtS: number, clockS: number): void {
    if (kind !== 'title' && kind !== 'intro' && kind !== 'gameover' && kind !== 'escaped' && kind !== 'victory') return;
    const p = this.world.player;
    if (nowMs >= this.nextAttractMs) {
      this.world.pulses.add(p.x, CONFIG.EYE_HEIGHT, p.z, clockS, 0.9);
      this.nextAttractMs = nowMs + CONFIG.ATTRACT_PULSE_MS;
    }
    this.world.pulses.prune(clockS);
    if (kind === 'title') p.yaw += CONFIG.TITLE_SPIN_RATE * dtS;
  }

  private confirmHint(action: string): string {
    return this.sim ? `Space (clap) to ${action}` : `Clap to ${action}`;
  }

  private updateOverlays(nowMs: number, intent: PlayerIntent, frames: SensorFrames | null): void {
    const playing = this.state.kind === 'playing';
    this.hud.show(playing);
    this.hud.update({
      levelName: this.world.level.def.name,
      objective: this.world.monstersEnabled
        ? 'Follow the red wall arrows. Claps reveal them—and tell the Hollows where you are.'
        : 'Find the way out. Follow the scratched red arrows on the walls.',
      prompt: playing ? this.hudPrompt(nowMs) : '',
      facePresent: intent.facePresent,
      micAboveDb: frames ? frames.mic.aboveDb : null,
      humHz: intent.hum ? (this.sim ? this.sim.pitchHz : (frames?.mic.humPitchHz ?? null)) : null,
      sim: this.sim !== null,
    });
    this.overlays.update({
      active: playing,
      danger: playing ? this.world.danger() : 0,
      hush: playing ? this.world.hushCloseness() : 0,
    });
    const p = this.world.player;
    this.debug.update({
      nowMs,
      renderFps: this.renderer.fps,
      face: this.sensors
        ? {
            frame: this.sensors.lastFace,
            faceFps: this.sensors.faceFps,
            delegate: this.sensors.face.delegate,
            blinkClose: this.calib.blinkClose,
            blinkOpen: this.calib.blinkOpen,
            eyesClosed: this.intents.eyes.closed,
            blinkCount: this.intents.eyes.blinkCount,
            relYawLeftDeg: this.intents.relYawLeftDeg,
            lean: this.intents.lean,
          }
        : undefined,
      mic: frames
        ? {
            frame: frames.mic,
            sampleRate: this.sensors!.mic.sampleRate,
            onsetMinAboveDb: CONFIG.ONSET_MIN_ABOVE_FLOOR_DB,
            humMinAboveDb: CONFIG.HUM_MIN_ABOVE_FLOOR_DB,
            gated: this.calib.speakerLeak,
          }
        : undefined,
      intent,
      game: {
        status: `${this.state.kind}/${this.world.status}`,
        scale: this.renderer.scale,
        danger: this.world.danger(),
        hush: this.world.hush
          ? this.world.hush.present
            ? `hush ${this.world.hush.distanceTo(p.x, p.z).toFixed(1)} m`
            : `hush silent ${(this.world.hush.silenceMs / 1000).toFixed(0)} s`
          : '',
        monsters: this.world.monsters.map((m) => ({
          id: m.id,
          state: m.state,
          distance: Math.hypot(m.x - p.x, m.z - p.z),
          moving: m.moving,
        })),
      },
    });
  }
}

function statsText(s: Stats): string {
  const total = Math.max(0, Math.round(s.ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  return `Time ${mm}:${ss} · Sounds made ${s.sounds}`;
}

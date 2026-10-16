import { Sfx } from '../audio/Sfx';
import { CONFIG } from '../config';
import { cellCenter } from '../game/grid';
import { LEVELS } from '../game/levels';
import { World, type WorldEvent } from '../game/World';
import { CalibrationRunner, defaultCalibration, type CalibCue, type CalibrationData } from '../input/calibration';
import { SensorError } from '../input/camera';
import { IntentBuilder } from '../input/IntentBuilder';
import { idleIntent, type PlayerIntent } from '../input/intent';
import { Sensors, type SensorFrames } from '../input/Sensors';
import { SimInput } from '../input/SimInput';
import { Renderer } from '../render/Renderer';
import { Card } from '../ui/Card';
import { DebugPanel } from '../ui/DebugPanel';
import { Hud } from '../ui/Hud';
import type { Flags } from './flags';

type State =
  | { kind: 'title' }
  | { kind: 'loading'; message: string }
  | { kind: 'error'; title: string; body: string }
  | { kind: 'calibrating'; runner: CalibrationRunner }
  | { kind: 'intro' }
  | { kind: 'playing' }
  | { kind: 'paused'; faceBackSinceMs: number | null }
  | { kind: 'caught' }
  | { kind: 'gameover' }
  | { kind: 'escaped' }
  | { kind: 'victory' };

interface Stats {
  ms: number;
  blinks: number;
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
  private readonly debug: DebugPanel;
  private readonly devBadge: HTMLElement;
  private readonly sim: SimInput | null;
  private sensors: Sensors | null = null;
  private sfx: Sfx | null = null;
  private calib: CalibrationData = defaultCalibration();
  private readonly intents = new IntentBuilder(this.calib);
  private world: World;
  private levelIndex: number;
  private state: State = { kind: 'title' };
  private stateSinceMs = performance.now();
  private readonly appStartMs = performance.now();
  private lastMs = this.appStartMs;
  private nextChimeMs = 0;
  private levelStartMs = 0;
  private blinksAtLevelStart = 0;
  private levelStats: Stats = { ms: 0, blinks: 0, sounds: 0 };
  private runStats: Stats = { ms: 0, blinks: 0, sounds: 0 };

  constructor(
    root: HTMLElement,
    private readonly flags: Flags,
  ) {
    root.innerHTML = `<div id="stage"></div><div id="dev-badge" class="dev-badge" hidden></div>`;
    this.renderer = new Renderer(root.querySelector<HTMLElement>('#stage')!);
    this.hud = new Hud(root);
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
    this.updateAudio(nowMs);
    this.updateOverlays(nowMs, intent, frames);
  };

  private step(nowMs: number, dtS: number, clockS: number, intent: PlayerIntent, frames: SensorFrames | null): void {
    const s = this.state;
    const menuReady = nowMs - this.stateSinceMs >= CONFIG.MENU_INPUT_DELAY_MS;
    const clap = intent.pulses.length > 0;

    switch (s.kind) {
      case 'title':
        this.card.show({
          title: 'ECHO',
          body:
            'A horror escape played in total darkness.\n' +
            'Clap to see. Hum to light the way. Lean to walk. Turn your head to look.\n' +
            'The Hollows hunt by sound, and they only move when your eyes are closed.',
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
        this.card.show({
          title: `${v.index}/${v.total} · ${v.title}`,
          body: v.prompt,
          progress: v.progress,
          tone: v.step === 'done' ? 'gold' : 'normal',
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

      case 'caught':
        this.card.hide();
        if (nowMs - this.stateSinceMs >= CONFIG.JUMPSCARE_MS) {
          this.renderer.hideJumpscare();
          this.setState({ kind: 'gameover' });
        }
        break;

      case 'gameover':
        this.card.show({
          title: 'THEY FOUND YOU',
          body: statsText(this.levelStats),
          hint: menuReady ? `${this.confirmHint('try again')}${this.sensors ? ' · Hum to recalibrate (new player)' : ''}` : '',
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
          hint: menuReady ? `${this.confirmHint('play again')}${this.sensors ? ' · Hum to recalibrate (new player)' : ''}` : '',
          tone: 'gold',
        });
        if (menuReady && clap) {
          this.runStats = { ms: 0, blinks: 0, sounds: 0 };
          this.startLevel(Math.min(1, LEVELS.length - 1)); // replays skip the tutorial
        } else if (menuReady && intent.humStarted && this.sensors) {
          this.startCalibration();
        }
        break;
    }
  }

  // ------------------------------------------------------------------ transitions

  private setState(next: State): void {
    this.state = next;
    this.stateSinceMs = performance.now();
  }

  /** Called from the Begin button's click handler: audio MUST be created synchronously here. */
  private begin(): void {
    if (this.state.kind !== 'title') return;
    const audio = new AudioContext({ latencyHint: 'interactive' });
    void audio.resume();
    this.sfx = new Sfx(audio, (gateMs) => this.onGameSound(gateMs));
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
    this.runStats = { ms: 0, blinks: 0, sounds: 0 };
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
    if (this.sfx) {
      this.sfx.clearVoices();
      for (const m of this.world.monsters) this.sfx.addVoice(m.id);
      const e = cellCenter(this.world.level.exit);
      this.sfx.setExitPosition(e.x, 1.3, e.z);
      this.sfx.startDrone();
    }
    this.setState({ kind: 'intro' });
  }

  private enterPlaying(nowMs: number): void {
    this.levelStartMs = nowMs;
    this.blinksAtLevelStart = this.intents.eyes.blinkCount;
    this.nextChimeMs = nowMs + 1000;
    this.sfx?.confirm();
    this.setState({ kind: 'playing' });
  }

  private finishLevel(nowMs: number): void {
    this.levelStats = this.measureLevel(nowMs);
    this.runStats = {
      ms: this.runStats.ms + this.levelStats.ms,
      blinks: this.runStats.blinks + this.levelStats.blinks,
      sounds: this.runStats.sounds + this.levelStats.sounds,
    };
    this.sfx?.confirm();
    this.setState({ kind: this.levelIndex >= LEVELS.length - 1 ? 'victory' : 'escaped' });
  }

  private measureLevel(nowMs: number): Stats {
    return {
      ms: nowMs - this.levelStartMs,
      blinks: this.intents.eyes.blinkCount - this.blinksAtLevelStart,
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
          this.renderer.afterimages.spawn(e.x, e.z, e.facing, e.strength, clockS);
          break;
        case 'caught':
          this.levelStats = this.measureLevel(nowMs);
          this.renderer.showJumpscare(clockS);
          this.sfx?.scream();
          this.debug.log(nowMs, `CAUGHT by #${e.monsterId}`);
          this.setState({ kind: 'caught' });
          break;
        case 'exit':
          this.debug.log(nowMs, 'EXIT reached');
          this.finishLevel(nowMs);
          break;
        case 'monsterMoveStart':
        case 'monsterMoveStop':
          break;
      }
    }
  }

  private updateAudio(nowMs: number): void {
    const sfx = this.sfx;
    if (!sfx) return;
    const p = this.world.player;
    sfx.setListener(p.x, CONFIG.EYE_HEIGHT, p.z, p.yaw);
    const active = this.state.kind === 'playing';
    for (const m of this.world.monsters) {
      sfx.updateVoice(m.id, m.x, m.z, active && m.moving, Math.hypot(m.x - p.x, m.z - p.z));
    }
    sfx.updateHeartbeat(nowMs, active ? this.world.danger() : 0);
    if (active && nowMs >= this.nextChimeMs) {
      sfx.chime();
      this.nextChimeMs = nowMs + CONFIG.CHIME_INTERVAL_MS;
    }
  }

  /** Mic gating when calibration found that the speakers reach the mic. */
  private onGameSound(gateMs: number): void {
    if (this.sensors && this.calib.speakerLeak) this.sensors.mic.gate(performance.now() + gateMs);
  }

  private playCue(cue: CalibCue): void {
    if (!this.sfx) return;
    if (cue === 'beep') this.sfx.beep();
    else if (cue === 'doubleBeep') this.sfx.doubleBeep();
    else if (cue === 'testTone') this.sfx.testTone();
    else this.sfx.tick();
  }

  private confirmHint(action: string): string {
    return this.sim ? `Space (clap) to ${action}` : `Clap to ${action}`;
  }

  private updateOverlays(nowMs: number, intent: PlayerIntent, frames: SensorFrames | null): void {
    const playing = this.state.kind === 'playing';
    this.hud.show(playing);
    this.hud.update({
      levelName: this.world.level.def.name,
      objective: this.world.monstersEnabled ? 'Escape. Follow the chime. Don’t blink.' : 'Find the way out. Follow the chime.',
      prompt: '',
      facePresent: intent.facePresent,
      eyesClosed: intent.eyesClosed,
      micAboveDb: frames ? frames.mic.aboveDb : null,
      humHz: intent.beam ? (this.sim ? this.sim.pitchHz : (frames?.mic.humPitchHz ?? null)) : null,
      sim: this.sim !== null,
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
        danger: this.world.danger(),
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
  return `Time ${mm}:${ss} · Blinks ${s.blinks} · Sounds made ${s.sounds}`;
}

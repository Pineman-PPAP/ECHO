import type { LevelDef } from './grid';

/**
 * Levels in play order. Tests in tests/world.test.ts and tests/moments.test.ts verify every level
 * parses, is solvable and that its moments sit on the route.
 * Pots (pots.ts) stand against one wall of a corridor; walking into one is as loud as a clap.
 * Each level has one authored pacing moment (moments.ts):
 *   Awakening    - a pair of red eyes watches you from beside the exit, then vanishes (no creature).
 *   The Listener - a long tunnel where the cave falls silent; it is waiting at the far end, by your turn.
 *   The Choir    - a Hollow walks right past while you hold still, then everything wakes up near the exit.
 */
export const LEVELS: LevelDef[] = [
  {
    id: 'tutorial',
    name: 'Awakening',
    tutorial: true,
    startFacing: 'E',
    intro: ['You wake up in total darkness.', 'Your voice is the only light you have.'],
    map: [
      '###########',
      '#S....#####',
      '#####.#####',
      '#####.....#',
      '#########.#',
      '#E........#',
      '###########',
    ],
    moments: [{ kind: 'watcher', trigger: { c: 8, r: 5 }, at: { c: 2, r: 5 } }],
    // One pot to learn on: nothing down here hears it yet.
    pots: [{ c: 7, r: 3, dx: 0, dz: -0.75 }],
  },
  {
    id: 'listener',
    name: 'The Listener',
    startFacing: 'W',
    intro: [
      'Something lives down here. It is blind.',
      'It hunts by sound. Every clap shows you the cave, and tells it where you are.',
      'Humming is quieter. Walking gently is silent.',
    ],
    map: [
      '#################',
      '#.....#.........#',
      '#####.#.#######.#',
      '#....S#.#.....#.#',
      '#.#####.#.###.#.#',
      '#.......#...#...#',
      '###.#############',
      '#..............##',
      '############.####',
      '#M.....#.....#..#',
      '#.#.##.##.#####.#',
      '#...#..........E#',
      '#################',
    ],
    moments: [
      { kind: 'quiet', from: { c: 4, r: 7 }, to: { c: 11, r: 7 } },
      {
        kind: 'ambush',
        trigger: { c: 9, r: 7 },
        monster: 0,
        at: { c: 14, r: 7 },
        prompt: 'It’s listening. Don’t clap. Lean gently and slip past.',
      },
    ],
    pots: [
      // Early: kicked at a walk it's too far away to hear; at full speed it carries to the Hollow below.
      { c: 1, r: 4, dx: 0.75, dz: 0 },
      // The last cell of the silent tunnel, three cells from where it waits.
      { c: 11, r: 7, dx: 0, dz: 0.75 },
      { c: 10, r: 9, dx: 0, dz: 0.75 },
      { c: 12, r: 11, dx: 0, dz: -0.75 },
    ],
  },
  {
    id: 'choir',
    name: 'The Choir',
    startFacing: 'E',
    hush: true,
    intro: [
      'There are more of them now.',
      'Your footsteps make noise too. Lean gently to sneak.',
      'And something else hunts silence. Don’t stay quiet too long.',
    ],
    map: [
      '###################',
      '#S......#.........#',
      '#.#####.#.#######.#',
      '#.#...#.#.#.....#.#',
      '#.#.#.#.#.#.###.#.#',
      '#...#.#...#.#M#.#.#',
      '#####.#####.#.#.#.#',
      '#.....#.....#...#.#',
      '#.#####.#########.#',
      '#.#...#.#.......#.#',
      '#.#.#.#.#.#####.#.#',
      '#.M.#...#.#.......#',
      '#.#######.#.#.#####',
      '#.........#M#....E#',
      '###################',
    ],
    moments: [
      {
        kind: 'walkPast',
        trigger: { c: 17, r: 8 },
        monster: 0,
        route: [
          { c: 12, r: 11 },
          { c: 13, r: 11 },
          { c: 14, r: 11 },
          { c: 15, r: 11 },
          { c: 15, r: 10 },
          { c: 15, r: 9 },
          { c: 14, r: 9 },
          { c: 13, r: 9 },
          { c: 12, r: 9 },
          { c: 11, r: 9 },
          { c: 10, r: 9 },
          { c: 9, r: 9 },
        ],
        prompt: 'Something is coming. Hold still. Don’t make a sound.',
      },
      { kind: 'finale', trigger: { c: 13, r: 12 }, prompt: 'THEY’RE AWAKE. RUN.' },
    ],
    pots: [
      { c: 4, r: 1, dx: 0, dz: 0.75 },
      { c: 9, r: 3, dx: -0.75, dz: 0 },
      { c: 13, r: 1, dx: 0, dz: 0.75 },
      { c: 17, r: 5, dx: -0.75, dz: 0 },
      // Where the walk-past Hollow just went by.
      { c: 16, r: 11, dx: 0, dz: -0.75 },
    ],
  },
];

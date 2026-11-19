// Port Aurelia — tuning, city layout and story data in one place.
// The world is a flat plane: x grows east, z grows south. The city grid sits
// north of a beach (large z), and the ocean lies beyond the sand.

export const WORLD = {
  roads: [-270, -180, -90, 0, 90, 180, 270],
  roadHalf: 11,
  cityMin: -330,
  cityMax: 330,
  beachZ: 208,
  oceanZ: 282,
  pierX: 0,
  pierEndZ: 352,
};

export const PLAYER = {
  radius: 0.9,
  walkSpeed: 11,
  sprintSpeed: 17,
  health: 100,
  meleeRange: 3.2,
  meleeDamage: 34,
  startX: -126,
  startZ: 178,
  startCash: 40,
};

export const CAR = {
  accel: 26,
  brake: 34,
  reverseMax: 12,
  turnRate: 1.9,
  grip: 7,
};

export const WANTED = {
  max: 5,
  decaySeconds: 14,
  bustSeconds: 2.4,
  policePerStar: 1,
};

export const SAVE_KEY = 'port-aurelia.save.v1';

export const PACKAGE_SPOTS = [
  [-238, -238], [-52, -262], [128, -238], [238, -52], [262, 128],
  [-262, 52], [-128, 128], [52, 52], [-52, 148], [148, -148],
  [8, 318], [-238, 178], [238, 190], [96, 224], [-96, 232],
  [178, -262], [-178, -88], [88, 88], [-8, -178], [200, 30],
];

export const AMMO_SPOTS = [
  [-84, 196], [84, -84], [-176, 6], [176, 96], [6, -266], [-266, -176],
];

export const LANDMARKS = {
  lighthouse: { x: 14, z: 348, h: 34 },
  ferris: { x: 196, z: 238, r: 26, h: 30 },
  motel: { x: -140, z: 196 },
  policeStation: { x: 96, z: -96 },
  hospital: { x: -96, z: -6 },
  garage: { x: 186, z: -186 },
};

// The story: Mara Voss works her way up the Solano crew. Each mission is a list
// of stages; a stage completes when its condition is met, then the next begins.
// Stage types: goto | drive | race (checkpoints against the clock) | collect |
// escape (reach the marker with no heat left).
export const MISSIONS = [
  {
    title: 'Shoreline Errand', giver: 'Coco at the Coral Motel', reward: 150,
    intro: 'Coco wants a word. Walk the promenade to the Seabreeze Café.',
    stages: [{ type: 'goto', x: 96, z: 190, label: 'Meet Coco at the Seabreeze Café' }],
  },
  {
    title: 'Borrowed Wheels', giver: 'Coco', reward: 250,
    intro: 'A teal coupe near the café was left unlocked. Coco needs it at Rook’s Garage.',
    stages: [
      { type: 'drive', x: 104, z: 176, carSpot: true, label: 'Take the teal coupe by the café' },
      { type: 'drive', x: 186, z: -172, label: 'Deliver the coupe to Rook’s Garage' },
    ],
  },
  {
    title: 'Pier Pressure', giver: 'Rook', reward: 400,
    intro: 'Rook bets you cannot run the shore checkpoints before the clock dies.',
    stages: [
      { type: 'goto', x: 6, z: 214, label: 'Get to the pier start line' },
      { type: 'race', time: 80, label: 'Hit every checkpoint before time runs out', points: [[-84, 196], [-176, 104], [-266, 10], [-176, -84], [-84, -176], [6, -84]] },
    ],
  },
  {
    title: 'Package Run', giver: 'Coco', reward: 450,
    intro: 'Three of Coco’s crates went missing around the marina blocks. Fetch them.',
    stages: [{ type: 'collect', count: 3, label: 'Recover Coco’s crates', points: [[-40, 130], [44, 96], [130, 140]] }],
  },
  {
    title: 'Heat Check', giver: 'Fixer Ivo', reward: 600,
    intro: 'Ivo torched the wrong warehouse. The PD is coming — shake them and reach the hideout.',
    stages: [
      { type: 'goto', x: -186, z: -96, label: 'Meet Ivo at the warehouse', armWanted: 2 },
      { type: 'escape', x: -262, z: 262, label: 'Lose the police, then reach the beach hideout' },
    ],
  },
  {
    title: 'Night Deposit', giver: 'Ivo', reward: 800,
    intro: 'Move the crew’s cash: bank vault first, then the docks, fast and clean.',
    stages: [
      { type: 'goto', x: -6, z: -96, label: 'Pick up the cash at Aurelia Bank' },
      { type: 'drive', x: 262, z: 150, time: 75, label: 'Reach the docks drop before the timer ends' },
    ],
  },
  {
    title: 'The Aurelia Grand Tour', giver: 'Rook', reward: 1000,
    intro: 'A rich tourist wants a driver who knows every corner. Run the grand tour.',
    stages: [
      { type: 'goto', x: 186, z: -172, label: 'Pick up the tourist at Rook’s Garage' },
      { type: 'race', time: 95, label: 'Grand tour checkpoints', points: [[262, -84], [96, 6], [186, 104], [6, 196], [-176, 104], [-84, -6], [-262, -186], [-96, -266]] },
    ],
  },
  {
    title: 'Last Light over Aurelia', giver: 'Coco', reward: 1500,
    intro: 'One last score: the case on the yacht pier. Take it, shake the PD, bring it home.',
    stages: [
      { type: 'goto', x: 4, z: 330, label: 'Grab the case at the end of the pier', armWanted: 3 },
      { type: 'escape', x: -140, z: 182, label: 'Lose the police and reach the Coral Motel' },
    ],
  },
];

export const PALETTE = {
  skyTop: '#2e1a4d', skyMid: '#b8456e', skyLow: '#ff9a56', sun: '#ffd76a',
  sea: '#1d6f8e', seaDeep: '#14506e', sand: '#e8c98a', grass: '#5d8a4e',
  road: '#3c3f4a', roadLine: '#f5d76e', sidewalk: '#9a93a3',
};

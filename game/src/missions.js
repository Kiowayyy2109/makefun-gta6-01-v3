// missions.js — the Port Aurelia story chain: seven missions for Mara Venn,
// a courier who keeps taking one job too many. Each mission is a list of
// phases; the world module walks the phases, shows the objective text, and
// pays the reward when the last phase completes.
//
// Phase kinds:
//   goto     reach the marker (any way you like)
//   race     reach each checkpoint in order before the clock runs out
//   collect  visit every point, in any order
//   escape   reach the hideout, then shake the wanted level down to zero
// A phase may carry a time limit in seconds and a setWanted level applied
// when the phase begins.

import { PLACES } from './city.js';

export const MISSIONS = [
  {
    title: 'First Wheels',
    brief: 'Rico left a car by the south avenue. Take it down to the pier and meet him at the end of the boardwalk.',
    reward: 300,
    phases: [
      { kind: 'goto', x: 68, z: 128, text: 'Get to the marked car on the south avenue' },
      { kind: 'goto', x: PLACES.pierEnd.x, z: PLACES.pierEnd.z - 12, text: 'Drive to Rico at the end of the pier' },
    ],
  },
  {
    title: 'Hot Package',
    brief: 'A parcel in the west district needs to cross town fast. No questions, no stops.',
    reward: 450,
    phases: [
      { kind: 'goto', x: -128, z: 68, text: 'Pick up the package in the west district' },
      { kind: 'goto', x: 188, z: -52, text: 'Deliver the package across town', timer: 130 },
    ],
  },
  {
    title: 'Aurelia Sprint',
    brief: 'The street racers want proof you can drive. Hit every checkpoint before the clock dies.',
    reward: 600,
    phases: [
      {
        kind: 'race', timer: 165, text: 'Hit every checkpoint before time runs out',
        points: [
          { x: 60, z: -60 }, { x: 180, z: -120 }, { x: 120, z: -240 },
          { x: -60, z: -180 }, { x: -180, z: -60 }, { x: -120, z: 120 },
        ],
      },
    ],
  },
  {
    title: 'Crates of the Coast',
    brief: 'Four crates fell off a truck around the marina and the boardwalk. Bring them all in.',
    reward: 550,
    phases: [
      {
        kind: 'collect', text: 'Collect the scattered crates',
        points: [
          { x: 96, z: 200 }, { x: -120, z: 200 }, { x: 44, z: 250 }, { x: -196, z: 188 },
        ],
      },
    ],
  },
  {
    title: 'Heat Wave',
    brief: 'The drop went loud and the whole force is awake. Get to the hideout and lie low until it blows over.',
    reward: 800,
    phases: [
      { kind: 'goto', x: 128, z: -128, text: 'Reach the drop point', setWanted: 3 },
      { kind: 'escape', x: PLACES.hideout.x, z: PLACES.hideout.z, text: 'Reach the hideout, then lose the police' },
    ],
  },
  {
    title: 'Showroom Shine',
    brief: 'A collector wants the display coupe from the car lot, delivered spotless to the north gate.',
    reward: 900,
    phases: [
      { kind: 'goto', x: PLACES.carLot.x, z: PLACES.carLot.z, text: 'Take the coupe from the car lot' },
      { kind: 'goto', x: -52, z: -248, text: 'Deliver the coupe to the north gate', timer: 120, setWanted: 2 },
    ],
  },
  {
    title: 'The Aurelia Job',
    brief: 'Three briefcases, one lighthouse, no second chances. This is the score that gets Mara out.',
    reward: 2000,
    phases: [
      {
        kind: 'collect', text: 'Grab the three briefcases',
        points: [
          { x: -150, z: 36 }, { x: 30, z: -58 }, { x: 172, z: 118 },
        ],
      },
      { kind: 'goto', x: PLACES.lighthouse.x - 10, z: PLACES.lighthouse.z - 14, text: 'Make the lighthouse rendezvous', timer: 170, setWanted: 2 },
    ],
  },
];

/** Total cash the whole chain pays, for the completion screen. */
export const TOTAL_REWARD = MISSIONS.reduce((sum, m) => sum + m.reward, 0);

// Palma City — global tuning constants

export const CFG = {
  SEED: 20260722,
  BLOCK: 74,        // interior size of a city block (metres)
  ROAD: 20,         // road width
  GRID: 10,         // blocks per side
  SIDEWALK: 5,      // sidewalk depth
  BEACH: 76,        // beach depth beyond the last road
  MAX_SPEED_SCALE: 1.0
};

export const PITCH = CFG.BLOCK + CFG.ROAD;
export const HALF = (CFG.GRID * PITCH) / 2;          // 470
export const WORLD_EDGE = HALF + CFG.ROAD / 2;        // 480
export const BEACH_END = WORLD_EDGE + CFG.BEACH;      // 556
export const OCEAN_END = BEACH_END + 900;

export const DISTRICTS = [
  { name: 'PALMA BEACH', test: (x, z) => z > WORLD_EDGE - PITCH * 1.6 },
  { name: 'DOWNTOWN', test: (x, z) => Math.abs(x) < PITCH * 1.8 && Math.abs(z) < PITCH * 1.8 },
  { name: 'THE DOCKS', test: (x, z) => x < -PITCH * 3.2 && z < 0 },
  { name: 'CORAL HEIGHTS', test: (x, z) => x > PITCH * 3.0 && z < PITCH * 2.0 },
  { name: 'SUNSET STRIP', test: (x, z) => z < -PITCH * 3.0 },
  { name: 'LITTLE SANTO', test: (x, z) => x < -PITCH * 2.2 && z > PITCH * 1.4 },
  { name: 'MARINA DISTRICT', test: () => true }
];

export const WEAPONS = {
  fists: { name: 'FISTS', dmg: 12, rpm: 130, mag: 0, spread: 0, range: 2.2, auto: false, melee: true },
  pistol: { name: 'PISTOL', dmg: 32, rpm: 340, mag: 12, reserve: 96, spread: 0.011, range: 130, auto: false, reload: 1.25, kick: 0.9 },
  smg: { name: 'MICRO SMG', dmg: 19, rpm: 800, mag: 30, reserve: 240, spread: 0.028, range: 110, auto: true, reload: 1.7, kick: 0.5 },
  shotgun: { name: 'SHOTGUN', dmg: 13, pellets: 8, rpm: 75, mag: 6, reserve: 48, spread: 0.07, range: 55, auto: false, reload: 2.1, kick: 2.2 },
  rifle: { name: 'CARBINE', dmg: 44, rpm: 420, mag: 30, reserve: 180, spread: 0.014, range: 200, auto: true, reload: 1.9, kick: 1.1 }
};

export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle'];

export const CAR_TYPES = {
  sedan: {
    name: 'Kaneo Sedan', length: 4.7, width: 1.86, height: 1.42, mass: 1450,
    accel: 9.4, top: 47, grip: 7.4, brake: 20, steer: 1.9,
    colors: ['#c8ccd2', '#1b1e24', '#7c1f24', '#25456e', '#e6e2d6', '#3f4a3c', '#8a5a2b']
  },
  sports: {
    name: 'Vulcano GT', length: 4.5, width: 1.98, height: 1.16, mass: 1280,
    accel: 14.5, top: 68, grip: 9.2, brake: 25, steer: 2.2,
    colors: ['#ff2d55', '#ffb300', '#f2f2f2', '#101216', '#00b8d4', '#6a1b9a']
  },
  suv: {
    name: 'Mesa Grande', length: 5.1, width: 2.06, height: 1.86, mass: 2100,
    accel: 7.6, top: 42, grip: 6.6, brake: 18, steer: 1.7,
    colors: ['#2b2f36', '#e8e8e8', '#4b5d4f', '#6d4c41', '#1e3a5f']
  },
  pickup: {
    name: 'Bravado Hauler', length: 5.4, width: 2.1, height: 1.9, mass: 2250,
    accel: 7.2, top: 40, grip: 6.2, brake: 17, steer: 1.6,
    colors: ['#8d1f1f', '#d9d3c3', '#2f3b2f', '#22303f', '#5a4632']
  },
  van: {
    name: 'Speedo Cargo', length: 5.2, width: 2.0, height: 2.25, mass: 2400,
    accel: 6.6, top: 38, grip: 6.0, brake: 16, steer: 1.5,
    colors: ['#e6e6e6', '#3d5a80', '#7a4a2b', '#2b2b2b']
  },
  taxi: {
    name: 'Cabbie', length: 4.75, width: 1.88, height: 1.48, mass: 1500,
    accel: 9.0, top: 45, grip: 7.2, brake: 19, steer: 1.9,
    colors: ['#ffc400']
  },
  police: {
    name: 'Police Cruiser', length: 4.95, width: 1.94, height: 1.5, mass: 1780,
    accel: 12.4, top: 58, grip: 8.4, brake: 23, steer: 2.1,
    colors: ['#0d1117']
  },
  muscle: {
    name: 'Sabre V8', length: 4.95, width: 1.94, height: 1.32, mass: 1560,
    accel: 12.0, top: 60, grip: 7.0, brake: 19, steer: 1.85,
    colors: ['#7a0f14', '#0f2a4a', '#1a1a1a', '#d8c26a', '#3b1f5e']
  },
  coupe: {
    name: 'Kaneo Coupe', length: 4.55, width: 1.9, height: 1.28, mass: 1380,
    accel: 11.2, top: 54, grip: 8.0, brake: 21, steer: 2.0,
    colors: ['#b8202a', '#1b1e24', '#e8e4d8', '#2a4a6a', '#c9a227', '#3d6b52']
  },
  hatch: {
    name: 'Punto Hatch', length: 3.95, width: 1.78, height: 1.52, mass: 1180,
    accel: 8.8, top: 44, grip: 7.6, brake: 19, steer: 2.1,
    colors: ['#6fb3c9', '#d8d8d8', '#8a2f4a', '#3f6b4a', '#22252a', '#c9762e']
  },
  bus: {
    name: 'Harbor Line Bus', length: 7.2, width: 2.3, height: 2.9, mass: 8500,
    accel: 5.2, top: 22, grip: 6.4, brake: 14, steer: 1.45,
    colors: ['#efe9dd']
  }
};

export const TRAFFIC_MIX = [
  ['sedan', 26], ['coupe', 9], ['hatch', 10], ['suv', 15], ['pickup', 9],
  ['van', 7], ['taxi', 9], ['sports', 8], ['muscle', 7]
];

export const STORY = {
  protagonist: 'Marisol Vega',
  partner: 'Dex Calloway',
  city: 'Palma City'
};

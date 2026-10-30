// One analytical domain shared by editor previews and the fluid runtime.
const BOUNDS_MIN = [-3.4, -1.2, -3.4];
const BOUNDS_MAX = [3.4, 3.0, 3.4];
const OBSTACLE_CENTER = [0.85, -0.43, 0.02];
const OBSTACLE_RADIUS = 0.52;

export function fingerFluidAnalyticalSupportGeometry() {
  return {boundsMin:[...BOUNDS_MIN],boundsMax:[...BOUNDS_MAX],obstacle:{center:[...OBSTACLE_CENTER],radius:OBSTACLE_RADIUS}};
}

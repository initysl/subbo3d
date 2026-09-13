/**
 * All tunable simulation constants in one place.
 *
 * Units are SI at true tabletop scale: metres, kilograms, seconds.
 * Real scale keeps the physics honest — feel is tuned through the friction
 * and restitution coefficients below, never by faking gravity.
 *
 * Equipment figures come from the FISTF equipment regulations. They are
 * marked VERIFY where they still need confirming against the official
 * Equipment Regulations Handbook PDF.
 */

/** Goal-to-goal axis. VERIFY: pitches vary between 1200 and 1210 mm. */
export const PITCH_LENGTH = 1.2;
/** Touchline-to-touchline axis. VERIFY: 770-800 mm depending on pitch. */
export const PITCH_WIDTH = 0.77;

export const HALF_LENGTH = PITCH_LENGTH / 2;
export const HALF_WIDTH = PITCH_WIDTH / 2;

/**
 * The shooting line sits parallel to, and equidistant between, the goal line
 * and the halfway line — so at a quarter of the pitch length from centre.
 */
export const SHOOTING_LINE_X = PITCH_LENGTH / 4;

/** VERIFY against the equipment handbook. */
export const GOAL_WIDTH = 0.15;
export const GOAL_HEIGHT = 0.05;
export const POST_RADIUS = 0.003;

/** Only 22 mm balls are legal for official play. */
export const BALL_RADIUS = 0.011;
/** Tournament balls weigh about 1.5 g. */
export const BALL_MASS = 0.0015;

/** Regulation base diameter is 16-21 mm; 20 mm sits in the usual range. */
export const BASE_RADIUS = 0.01;
/** Regulation base height is 5-7 mm. */
export const BASE_HEIGHT = 0.006;
/**
 * Base mass is not regulated the way the ball is. It is chosen purely for the
 * mass ratio against the ball, which is what makes the ball leave the base
 * satisfyingly rather than shoving it.
 */
export const BASE_MASS = 0.005;

export const GRAVITY = 9.81;

/**
 * Coulomb friction coefficients — constant deceleration, not exponential drag.
 * A disc on felt slows linearly and stops in finite time; exponential decay
 * asymptotes and feels floaty.
 */
export const MU_BASE = 0.32;
export const MU_BALL = 0.22;

/**
 * A small viscous term layered on top of Coulomb friction. Not physical: it
 * takes the edge off the very top of the power curve so that a maximum-power
 * flick does not sail off the pitch. Start near zero and raise only if needed.
 */
export const K_VISC_BASE = 0.9;
export const K_VISC_BALL = 1.6;

export const E_BASE_BASE = 0.3;
export const E_BASE_BALL = 0.55;
export const E_BALL_GROUND = 0.35;
export const E_WALL = 0.45;
export const E_BALL_POST = 0.6;

/**
 * Coulomb coefficient for the tangential impulse at a contact. This is what
 * turns a glancing hit into a deflection rather than a clean bounce, and it is
 * where most of the skill expression in aiming comes from.
 */
export const MU_CONTACT = 0.2;
/** Horizontal speed the felt steals from the ball on each bounce. */
export const BOUNCE_TANGENT_LOSS = 0.18;

/** Fixed simulation timestep. Render interpolates between steps. */
export const DT = 1 / 240;

/**
 * Maximum collision events resolved within a single step before we give up and
 * advance the remaining time ballistically. 25 bodies on an open plane never
 * come close; the cap only exists so a pathological case cannot hang the loop.
 */
export const MAX_EVENTS_PER_STEP = 32;

/** Consecutive steps a body must be slow before it is put to sleep. */
export const REST_STEPS = 12;
/** Speed below which a body counts as at rest. */
export const REST_SPEED = 0.012;
/** Vertical speed below which the ball counts as grounded. */
export const REST_VZ = 0.05;
/** Ball height below which it is treated as resting on the felt. */
export const BALL_AIRBORNE_EPS = 0.0004;
/** Bounce velocity below which the ball simply settles instead of bouncing. */
export const BALL_VZ_SLEEP = 0.14;

/**
 * Hard cap on how long a turn may take to settle, after which all velocities
 * are zeroed. This is not a safety valve but a rules guarantee: bounded turn
 * length is something both the AI search and online lockstep depend on.
 */
export const SETTLE_TIMEOUT_STEPS = 1200;

/**
 * Height gating. A figure only blocks the ball while the ball is below this;
 * above it, chips sail over. This one comparison is the entire reason lofted
 * passes are worth playing.
 */
export const FIGURE_BLOCK_HEIGHT = 0.03;
export const KEEPER_BLOCK_HEIGHT = 0.045;
export const KEEPER_RADIUS = 0.0125;
export const KEEPER_MASS = 0.018;

/** Vertical velocity imparted to the ball per unit of loft and impulse. */
export const CHIP_GAIN = 2.2;

/** Fastest legal flick, in metres per second. */
export const MAX_FLICK_SPEED = 2.6;

/** Quantisation scale for flick input — see lib/sim/input.ts. */
export const IMPULSE_QUANTISE = 10000;

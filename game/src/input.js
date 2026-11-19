// input.js — keyboard and mouse state for Port Aurelia.
// Held keys live in a Set keyed by KeyboardEvent.code; one-shot actions are
// latched into a pressed set that the game loop drains once per frame, so a
// tap is never lost between frames and never fires twice.

export const ACT_FORWARD = 'forward';
export const ACT_BACK = 'back';
export const ACT_LEFT = 'left';
export const ACT_RIGHT = 'right';
export const ACT_SPRINT = 'sprint';
export const ACT_BRAKE = 'brake';

const HELD = {
  KeyW: ACT_FORWARD, ArrowUp: ACT_FORWARD,
  KeyS: ACT_BACK, ArrowDown: ACT_BACK,
  KeyA: ACT_LEFT, ArrowLeft: ACT_LEFT,
  KeyD: ACT_RIGHT, ArrowRight: ACT_RIGHT,
  ShiftLeft: ACT_SPRINT, ShiftRight: ACT_SPRINT,
  Space: ACT_BRAKE,
};

export function createInput(target) {
  const held = new Set();
  const pressed = new Set();
  let mouseDown = false;
  let mouseClicked = false;
  let aimX = 0;
  let aimY = 0;

  function onKeyDown(event) {
    const action = HELD[event.code];
    if (action) {
      held.add(action);
      if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
    }
    if (!event.repeat) pressed.add(event.code);
  }
  function onKeyUp(event) {
    const action = HELD[event.code];
    if (action) held.delete(action);
  }
  function onBlur() {
    held.clear();
    mouseDown = false;
  }
  function onMouseDown(event) {
    if (event.button === 0) {
      mouseDown = true;
      mouseClicked = true;
    }
  }
  function onMouseUp(event) {
    if (event.button === 0) mouseDown = false;
  }
  function onMouseMove(event) {
    aimX = event.clientX;
    aimY = event.clientY;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  target.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);

  return {
    /** Is a movement action currently held? */
    down(action) { return held.has(action); },
    /** Was this physical key pressed since the last drain? Drains the latch. */
    pressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    /** Any of the given codes pressed since last drain (drains all of them). */
    pressedAny(codes) {
      let hit = false;
      for (const code of codes) if (pressed.delete(code)) hit = true;
      return hit;
    },
    clearPressed() { pressed.clear(); },
    mouseHeld() { return mouseDown; },
    /** True once per physical click. */
    takeMouseClick() {
      const was = mouseClicked;
      mouseClicked = false;
      return was;
    },
    aim() { return { x: aimX, y: aimY }; },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      target.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
    },
  };
}

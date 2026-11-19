// Port Aurelia — keyboard and mouse input. Held keys are read as a live
// state; one-shot presses (enter car, melee, pause, confirm) are latched so
// a press between frames is never lost.

export function createInput() {
  const held = new Set();
  const pressed = new Set();
  let clicked = false;

  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    held.add(e.code);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); });
  window.addEventListener('pointerdown', () => { clicked = true; pressed.add('Mouse'); });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  const any = (...codes) => codes.some((c) => held.has(c));
  return {
    forward: () => any('KeyW', 'ArrowUp'),
    back: () => any('KeyS', 'ArrowDown'),
    left: () => any('KeyA', 'ArrowLeft'),
    right: () => any('KeyD', 'ArrowRight'),
    sprint: () => any('ShiftLeft', 'ShiftRight'),
    brake: () => held.has('Space'),
    /** One-shot: true once per physical press of any listed code. */
    take(...codes) {
      let hit = false;
      for (const c of codes) if (pressed.has(c)) { pressed.delete(c); hit = true; }
      return hit;
    },
    takeClick() { const c = clicked; clicked = false; return c; },
    clear() { pressed.clear(); clicked = false; },
  };
}

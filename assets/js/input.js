/* Tastatur und Maus. Bis zu drei Tastenbelegungen teilen sich eine Tastatur. */
(function (global) {
  'use strict';

  var UDM = global.UDM;

  UDM.LAYOUTS = [
    { left: 'KeyA', right: 'KeyD', jump: 'KeyW', down: 'KeyS', label: 'A D / W / S' },
    { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', down: 'ArrowDown', label: '← → / ↑ / ↓' },
    { left: 'KeyJ', right: 'KeyL', jump: 'KeyI', down: 'KeyK', label: 'J L / I / K' },
    // Vierter Spieler: F/H/T/G - oder der Ziffernblock, wer einen hat.
    {
      left: ['KeyF', 'Numpad4'],
      right: ['KeyH', 'Numpad6'],
      jump: ['KeyT', 'Numpad8'],
      down: ['KeyG', 'Numpad5'],
      label: 'F H / T / G oder Ziffernblock'
    }
  ];

  /* Im Online-Modus steuert man nur eine Figur - dann zaehlen beide Belegungen. */
  var SOLO_LAYOUT = {
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    jump: ['KeyW', 'ArrowUp', 'Space'],
    down: ['KeyS', 'ArrowDown'],
    label: 'A D oder Pfeiltasten, W / ↑ springt'
  };
  UDM.SOLO_LAYOUT = SOLO_LAYOUT;

  var BLOCKED_KEYS = {
    ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1, Tab: 1
  };

  var Input = {
    down: {},
    pressed: {},
    mouse: { x: 0, y: 0, tx: -1, ty: -1, inside: false, clicked: false, right: false },
    canvas: null,

    init: function (canvas) {
      this.canvas = canvas;
      var self = this;

      global.addEventListener('keydown', function (e) {
        if (e.repeat) { return; }
        if (BLOCKED_KEYS[e.code]) { e.preventDefault(); }
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { return; }
        self.down[e.code] = true;
        self.pressed[e.code] = true;
        UDM.Audio.resume();
      });

      global.addEventListener('keyup', function (e) {
        self.down[e.code] = false;
      });

      global.addEventListener('blur', function () {
        self.down = {};
      });

      if (canvas) {
        canvas.addEventListener('mousemove', function (e) { self.updateMouse(e); });
        canvas.addEventListener('mouseenter', function (e) { self.mouse.inside = true; self.updateMouse(e); });
        canvas.addEventListener('mouseleave', function () { self.mouse.inside = false; });
        canvas.addEventListener('mousedown', function (e) {
          UDM.Audio.resume();
          self.updateMouse(e);
          if (e.button === 0) { self.mouse.clicked = true; }
          if (e.button === 2) { self.mouse.right = true; }
        });
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        canvas.addEventListener('touchstart', function (e) {
          UDM.Audio.resume();
          if (e.touches.length) {
            self.updateMouse(e.touches[0]);
            self.mouse.inside = true;
            self.mouse.clicked = true;
          }
        }, { passive: true });
      }
    },

    updateMouse: function (e) {
      if (!this.canvas) { return; }
      var rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) { return; }
      var scaleX = UDM.worldWidth() / rect.width;
      var scaleY = UDM.worldHeight() / rect.height;
      this.mouse.x = (e.clientX - rect.left) * scaleX;
      this.mouse.y = (e.clientY - rect.top) * scaleY;
      this.mouse.tx = Math.floor(this.mouse.x / UDM.TILE);
      this.mouse.ty = Math.floor(this.mouse.y / UDM.TILE);
      this.mouse.inside = true;
    },

    isDown: function (code) {
      if (Array.isArray(code)) {
        for (var i = 0; i < code.length; i++) {
          if (this.down[code[i]]) { return true; }
        }
        return false;
      }
      return !!this.down[code];
    },

    wasPressed: function (code) {
      if (Array.isArray(code)) {
        for (var i = 0; i < code.length; i++) {
          if (this.pressed[code[i]]) { return true; }
        }
        return false;
      }
      return !!this.pressed[code];
    },

    /** Steuerzustand fuer eine Figur nach der gegebenen Belegung. */
    stateFor: function (layout) {
      return {
        left: this.isDown(layout.left),
        right: this.isDown(layout.right),
        jump: this.isDown(layout.jump),
        down: this.isDown(layout.down),
        jumpPressed: this.wasPressed(layout.jump)
      };
    },

    idle: function () {
      return { left: false, right: false, jump: false, down: false, jumpPressed: false };
    },

    /** Am Ende jedes Frames: Flanken zuruecksetzen. */
    endFrame: function () {
      this.pressed = {};
      this.mouse.clicked = false;
      this.mouse.right = false;
    }
  };

  UDM.Input = Input;
}(window));

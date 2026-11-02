// Brand configuration. Edit this file to adjust colours, copy and the logo
// without touching the game code.
window.BRAND = {
  // Swap assets/logo.svg for the official logo file from the BMW brand portal
  // (keep the same filename, or change the path here).
  logo: "assets/logo.svg",
  tagline: "Sheer Driving Pleasure.",

  colors: {
    background: "#0b0d10", // deep carbon
    table: "#11151b",
    lines: "rgba(255,255,255,0.14)",
    primary: "#1c69d4",    // BMW blue
    mLight: "#81c4ff",     // M stripe: light blue
    mDark: "#16588e",      // M stripe: dark blue
    mRed: "#e7222e",       // M stripe: red
    ball: "#ffffff",
    text: "#ffffff",
  },

  // Paddle colours for player 1 (left) and player 2 / CPU (right)
  paddles: ["#1c69d4", "#e7222e"],

  names: { p1: "PLAYER 1", p2: "PLAYER 2", cpu: "CPU" },
};

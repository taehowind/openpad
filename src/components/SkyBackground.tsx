// Animated backdrop behind the whole app. One set of layers serves both themes; the CSS decides
// what they depict. In dark mode it is a night sky — nebulae, the milky way, stars, meteors. In
// light mode the same layers become a daylit page: washes of colour bleeding across paper, a soft
// shaft of light, and dust drifting through it.
//
// Depth comes from parallax: three drift fields sit at different translateZ and move at different
// rates, so the near ones visibly outrun the far ones. Each field is a single element — the specks
// are tiled radial-gradients, not hundreds of nodes — which keeps the whole scene at a handful of
// composited layers.
//
// Deliberately zero JavaScript: plain markup animated by CSS keyframes that touch only transform
// and opacity, so every frame stays on the GPU and never repaints the app above it.
export function SkyBackground() {
  return (
    <div className="skyscape" aria-hidden="true">
      {/* Colour bed: the atmosphere, plus slow drifting masses of colour. */}
      <div className="sky-wash">
        <span className="wash w-1" />
        <span className="wash w-2" />
        <span className="wash w-3" />
      </div>

      {/* A band of light raked across the frame — the milky way at night, a sun shaft by day. */}
      <div className="sky-band" />

      {/* Three parallax drift fields, far to near. */}
      <div className="sky-drift">
        <div className="drift-field field-far" />
        <div className="drift-field field-mid" />
        <div className="drift-field field-near" />
      </div>

      {/* Occasional meteors. Long cycles with staggered delays so they stay a surprise. Night only:
          a shooting star at midday would read as a glitch rather than a flourish. */}
      <div className="sky-streaks">
        <span className="streak s-1" />
        <span className="streak s-2" />
        <span className="streak s-3" />
      </div>

      {/* Damps the brightest areas so panels above keep their text contrast. */}
      <div className="sky-veil" />
    </div>
  );
}

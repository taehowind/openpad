// Night-sky backdrop behind the whole app. Rendered on every page but only revealed by CSS in
// dark mode, so light mode pays nothing for it.
//
// Depth comes from parallax: three star fields sit at different translateZ and drift at
// different rates, so the near stars visibly outrun the far ones. Each field is a single
// element — the stars are tiled radial-gradients, not hundreds of nodes — which keeps the whole
// sky at a handful of composited layers.
//
// Deliberately zero JavaScript: plain markup animated by CSS keyframes that touch only
// transform and opacity, so every frame stays on the GPU and never repaints the app above it.
export function NightSkyBackground() {
  return (
    <div className="nightsky" aria-hidden="true">
      {/* Colour bed: deep atmosphere plus slow nebula clouds. */}
      <div className="sky-nebula">
        <span className="nebula n-1" />
        <span className="nebula n-2" />
        <span className="nebula n-3" />
      </div>

      {/* The milky way, banked across the frame. */}
      <div className="sky-band" />

      {/* Three parallax star fields, far to near. */}
      <div className="sky-stars">
        <div className="star-field field-far" />
        <div className="star-field field-mid" />
        <div className="star-field field-near" />
      </div>

      {/* Occasional meteors. Long cycles with staggered delays so they stay a surprise. */}
      <div className="sky-meteors">
        <span className="meteor m-1" />
        <span className="meteor m-2" />
        <span className="meteor m-3" />
      </div>

      {/* Damps the brightest areas so glass panels keep their text contrast. */}
      <div className="sky-veil" />
    </div>
  );
}

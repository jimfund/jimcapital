// The four inner corners of the billboard in the 1672 × 941 artwork.
// Map a readable rectangular HTML display onto its photographed perspective.
export const SCREEN_CORNERS = [[1240, 235], [1551, 408], [1500, 805], [1153, 670]];
export const SCREEN_WIDTH = 360, SCREEN_HEIGHT = 560, ART_WIDTH = 1672;
export function screenMatrix(scale = 1) {
 const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = SCREEN_CORNERS.map(([x, y]) => [x * scale, y * scale]);
 const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
 const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
 const determinant = dx1 * dy2 - dx2 * dy1;
 const g = (dx3 * dy2 - dx2 * dy3) / determinant;
 const h = (dx1 * dy3 - dx3 * dy1) / determinant;
 const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3;
 const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
 return [a / SCREEN_WIDTH, d / SCREEN_WIDTH, 0, g / SCREEN_WIDTH,
  b / SCREEN_HEIGHT, e / SCREEN_HEIGHT, 0, h / SCREEN_HEIGHT,
  0, 0, 1, 0, x0, y0, 0, 1];
}
export function mountAirship(root) {
 const screen = root.querySelector('.airship-display');
 const fit = () => {
  if (!root.clientWidth) return;
  screen.style.transform = `matrix3d(${screenMatrix(root.clientWidth / ART_WIDTH).join(',')})`;
  screen.dataset.ready = 'true';
 };
 const observer = new ResizeObserver(fit);
 observer.observe(root); fit();
 return () => observer.disconnect();
}
if (typeof document !== 'undefined') {
 const root = document.querySelector('.market-airship');
 if (root) mountAirship(root);
}

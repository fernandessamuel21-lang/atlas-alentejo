/* Operações geométricas em coordenadas do modelo (X, Z), sem dependências. */
(function (root) {
  "use strict";
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i],
        [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }
  function inPolygon(x, y, rings) {
    return (
      inRing(x, y, rings[0]) && !rings.slice(1).some((r) => inRing(x, y, r))
    );
  }
  function polygons(geometry) {
    if (geometry.type === "Polygon") return [geometry.coordinates];
    if (geometry.type === "MultiPolygon") return geometry.coordinates;
    return [];
  }
  function lines(geometry) {
    if (geometry.type === "LineString") return [geometry.coordinates];
    if (geometry.type === "MultiLineString") return geometry.coordinates;
    return polygons(geometry).flat();
  }
  function segmentDistance(x, y, a, b) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const denominator = dx * dx + dy * dy;
    const t = denominator
      ? Math.max(
          0,
          Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / denominator),
        )
      : 0;
    return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
  }
  function distance(x, y, geometry) {
    if (polygons(geometry).some((p) => inPolygon(x, y, p))) return 0;
    let best = Infinity;
    for (const line of lines(geometry))
      for (let i = 1; i < line.length; i++) {
        best = Math.min(best, segmentDistance(x, y, line[i - 1], line[i]));
      }
    return best;
  }
  function normalize(value) {
    return String(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }
  const api = { inRing, inPolygon, polygons, lines, distance, normalize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AtlasGeo = api;
})(typeof window !== "undefined" ? window : globalThis);

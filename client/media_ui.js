export function getVideoQualityConstraints(qualityValue) {
  const quality = Number(qualityValue) || 720;
  const map = {
    360: { w: 640, h: 360 },
    480: { w: 854, h: 480 },
    720: { w: 1280, h: 720 },
    1080: { w: 1920, h: 1080 },
    1440: { w: 2560, h: 1440 },
    2160: { w: 3840, h: 2160 }
  };
  const size = map[quality] || map[720];
  return {
    width: { ideal: size.w },
    height: { ideal: size.h },
    frameRate: { ideal: 30, max: 60 }
  };
}

export function getMediaGridStyle(tileCols) {
  if (tileCols === "auto") return {};
  const cols = Number(tileCols);
  if (!Number.isInteger(cols) || cols < 1) return {};
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
}

export interface Camera { x: number; y: number; scale: number }
export function fitCamera(width: number, height: number, viewportWidth: number, viewportHeight: number): Camera {
  const scale = Math.max(0.55, Math.min(1.2, (viewportWidth - 48) / width, (viewportHeight - 48) / height));
  return { scale, x: Math.max(24, (viewportWidth - width * scale) / 2), y: Math.max(24, (viewportHeight - height * scale) / 2) };
}
export function zoomCamera(camera: Camera, multiplier: number, x: number, y: number): Camera {
  const scale = Math.max(0.2, Math.min(3, camera.scale * multiplier));
  return { scale, x: x - (x - camera.x) * scale / camera.scale, y: y - (y - camera.y) * scale / camera.scale };
}

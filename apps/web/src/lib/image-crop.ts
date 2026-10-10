export function cropRectangle(
  width: number,
  height: number,
  ratio: number,
  zoom: number,
  x: number,
  y: number,
) {
  const cropWidth = Math.min(width, height * ratio) / zoom;
  const cropHeight = cropWidth / ratio;
  return {
    x: ((width - cropWidth) * x) / 100,
    y: ((height - cropHeight) * y) / 100,
    width: cropWidth,
    height: cropHeight,
  };
}

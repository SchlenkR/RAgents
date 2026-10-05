export interface ImageSize {
  width: number;
  height: number;
}

export interface ImageTransform {
  scale: number;
  x: number;
  y: number;
}

export const fitImageScale = (image: ImageSize, viewport: ImageSize): number =>
  Math.min(1, viewport.width / image.width, viewport.height / image.height);

export const constrainImage = (transform: ImageTransform, image: ImageSize, viewport: ImageSize): ImageTransform => {
  const limitX = Math.max(0, (image.width * transform.scale - viewport.width) / 2);
  const limitY = Math.max(0, (image.height * transform.scale - viewport.height) / 2);
  return {
    scale: transform.scale,
    x: limitX === 0 ? 0 : Math.max(-limitX, Math.min(limitX, transform.x)),
    y: limitY === 0 ? 0 : Math.max(-limitY, Math.min(limitY, transform.y)),
  };
};

export const zoomImage = (transform: ImageTransform, scale: number, pointer: { x: number; y: number }): ImageTransform => ({
  scale,
  x: pointer.x - (pointer.x - transform.x) * scale / transform.scale,
  y: pointer.y - (pointer.y - transform.y) * scale / transform.scale,
});

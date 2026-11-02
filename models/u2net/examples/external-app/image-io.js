export async function readImage(input) {
  const blob = typeof input === 'string' ? await fetch(input).then(response => {
    if (!response.ok) throw Error(`Image: HTTP ${response.status}`);
    return response.blob();
  }) : input;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return { width: canvas.width, height: canvas.height,
      rgba: context.getImageData(0, 0, canvas.width, canvas.height).data };
  } finally { bitmap.close(); }
}

export async function downloadPng(image, name) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('PNG export failed');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

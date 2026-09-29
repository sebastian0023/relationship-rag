export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface PhotoCandidate {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

const mebibytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1).replace('.', ',');

/** Why a chosen file cannot be uploaded, or `null` when it can. Checked before any request. */
export const photoProblem = (file: PhotoCandidate, photosInMemory: number): string | null => {
  if (photosInMemory >= MAX_PHOTOS) return 'Este recuerdo ya tiene 10 fotografías, el máximo.';
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return /heic|heif/i.test(`${file.type} ${file.name}`)
      ? `«${file.name}» es un archivo HEIC y no es compatible. Elige una versión en JPEG: en iPhone, ve a Ajustes › Cámara › Formatos y marca «Más compatible», o exporta la foto como JPEG desde la app Fotos antes de subirla.`
      : `«${file.name}» no es compatible. Elige un archivo JPEG, PNG o WebP.`;
  }
  if (file.size > MAX_PHOTO_BYTES)
    return `«${file.name}» pesa ${mebibytes(file.size)} MiB y el máximo es 10 MiB. Elige una versión más liviana.`;
  return null;
};

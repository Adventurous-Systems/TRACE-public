/**
 * Photo upload limits (owner, 2026-10-07). The API reads them as the defaults
 * of UPLOAD_MAX_BYTES and PASSPORT_PHOTOS_MAX, which a site can lower or
 * raise; the web app checks the defaults before sending, so a person hears
 * about a photo that is too large before it uploads.
 */
export const PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const PASSPORT_PHOTOS_MAX = 8;

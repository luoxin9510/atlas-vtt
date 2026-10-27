/** The bytes of a PNG as a `data:` URL, as the lighting store keeps the explored mask. */
export function dataUrlOfPng(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:image/png;base64,${btoa(binary)}`;
}

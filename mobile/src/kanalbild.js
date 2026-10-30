/** Only called by an explicit button press. No camera or microphone access. */
export async function kanalbildWaehlen() {
  const picker = await import("expo-image-picker");
  const result = await picker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
    throw new Error("Dieses Bild konnte nicht gelesen werden.");
  }
  if (asset.fileSize > 20 * 1024 * 1024 || asset.width * asset.height > 40_000_000) {
    throw new Error("Bitte ein kleineres Bild wählen (höchstens 20 MB und 40 Megapixel).");
  }
  const { manipulateAsync, SaveFormat } = await import("expo-image-manipulator");
  const factor = Math.min(1, 960 / Math.max(asset.width, asset.height));
  const image = await manipulateAsync(asset.uri, [{ resize: {
    width: Math.max(1, Math.round(asset.width * factor)), height: Math.max(1, Math.round(asset.height * factor)),
  } }], { format: SaveFormat.JPEG, compress: 0.85, base64: true });
  if (!image.base64 || image.base64.length > 1_500_000) throw new Error("Das verkleinerte Bild ist noch zu groß. Bitte ein anderes wählen.");
  return `data:image/jpeg;base64,${image.base64}`;
}

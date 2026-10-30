/** Der Build bestimmt das Produkt; die Bildschirmbreite macht kein Handy zum TV. */
export const istTVProdukt = process.env.EXPO_PUBLIC_APP_VARIANT === "tv";
export const APP_VERSION = "3.4.0";
export const APP_NAME = istTVProdukt ? "GHGFlix TV" : "GHGFlix Mobile";

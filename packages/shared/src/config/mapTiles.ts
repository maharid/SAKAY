/**
 * The base map every SAKAY screen draws (passenger, driver, LGU and TODA apps), in ONE place.
 *
 * Why not OpenStreetMap's own tile server: it is a volunteer-run service that refuses ("403 Access blocked") any request that does not
 * carry a usable HTTP Referer, and many browsers, privacy extensions and embedded browsers strip it, so the map turned into rows of
 * "Access blocked" pictures. It is also not meant to carry an app's traffic. Esri's World Street Map answers every request, with or
 * without a Referer, needs no key, and shows the streets and barangay names of Calapan.
 *
 * Tiles are addressed {z}/{y}/{x} (row before column) on this service.
 * To change the base map for the whole system, change it here and nowhere else.
 */
export const MAP_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

export const MAP_TILE_ATTRIBUTION = 'Tiles &copy; Esri';

/** Leaflet options for the tile layer: the service has real tiles up to zoom 18; closer than that the last tile is scaled up. */
export const MAP_TILE_OPTIONS = {
  maxZoom: 19,
  maxNativeZoom: 18,
  attribution: MAP_TILE_ATTRIBUTION,
} as const;

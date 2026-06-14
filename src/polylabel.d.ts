declare module "polylabel" {
  /** Returns the polygon's pole of inaccessibility as [x, y] (i.e. [lng, lat]). */
  // noinspection JSUnusedGlobalSymbols
  export default function polylabel(
    polygon: number[][][],
    precision?: number,
    debug?: boolean
  ): [number, number];
}

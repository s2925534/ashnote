import Svg, { Rect } from "react-native-svg";
import { avatarFor } from "../core/identity";

/** A pattern made from the key, drawn next to its alias. */
export function Avatar({ pubkey, size = 36 }: { pubkey: string; size?: number }) {
  const { hue, cells } = avatarFor(pubkey);
  return (
    <Svg width={size} height={size} viewBox="-1 -1 7 7" style={{ borderRadius: size * 0.28, overflow: "hidden" }}>
      <Rect x={-1} y={-1} width={7} height={7} fill={`hsl(${hue}, 60%, 90%)`} />
      {cells.flatMap((row, y) =>
        row.map((on, x) => (on ? <Rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={`hsl(${hue}, 62%, 40%)`} /> : null)),
      )}
    </Svg>
  );
}

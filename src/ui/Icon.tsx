import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName = "gear" | "send" | "trash" | "chat" | "qr" | "camera" | "back" | "close";

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  const p = { stroke: color, strokeWidth: 1.9, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "gear" && (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" {...p} />
        </>
      )}
      {name === "send" && <Path d="M5 12h13M13 6l6 6-6 6" {...p} />}
      {name === "trash" && <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" {...p} />}
      {name === "chat" && <Path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" {...p} />}
      {name === "qr" && (
        <>
          <Rect x={3} y={3} width={7} height={7} rx={1} {...p} />
          <Rect x={14} y={3} width={7} height={7} rx={1} {...p} />
          <Rect x={3} y={14} width={7} height={7} rx={1} {...p} />
          <Path d="M14 14h3v3M21 14v7h-7v-3" {...p} />
        </>
      )}
      {name === "camera" && (
        <>
          <Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" {...p} />
          <Circle cx={12} cy={13.5} r={3.5} {...p} />
        </>
      )}
      {name === "back" && <Path d="M15 5l-7 7 7 7" {...p} />}
      {name === "close" && <Path d="M6 6l12 12M18 6L6 18" {...p} />}
    </Svg>
  );
}

import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName = "gear" | "send" | "trash" | "chat" | "qr" | "camera" | "back" | "close" | "alert" | "pin" | "system" | "sun" | "moon" | "play" | "image" | "plus" | "group";

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
      {name === "system" && (
        <>
          <Rect x={3} y={4} width={18} height={13} rx={1.5} {...p} strokeWidth={1.75} />
          <Path d="M8 20h8M12 17v3" {...p} strokeWidth={1.75} />
        </>
      )}
      {name === "sun" && (
        <>
          <Circle cx={12} cy={12} r={4.5} {...p} strokeWidth={1.75} />
          <Path d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M19.07 4.93l-1.77 1.77M6.7 17.3l-1.77 1.77M19.07 19.07l-1.77-1.77M6.7 6.7 4.93 4.93" {...p} strokeWidth={1.75} />
        </>
      )}
      {name === "image" && (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2} {...p} />
          <Circle cx={9} cy={10} r={1.8} {...p} />
          <Path d="M21 16l-5-5-8 8" {...p} />
        </>
      )}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === "group" && (
        <>
          <Circle cx={9} cy={8} r={3.2} {...p} />
          <Path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3.2 3.2 0 0 1 0 6M18 14.4c1.8.8 3 2.6 3 4.6" {...p} />
        </>
      )}
      {name === "play" && <Path d="M8 5.5v13l10.5-6.5L8 5.5z" {...p} />}
      {name === "moon" && <Path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" {...p} strokeWidth={1.75} />}
      {name === "alert" && <Path d="M12 3l9.5 17h-19L12 3zM12 10v4.5M12 17.5v.01" {...p} />}
      {name === "pin" && (
        <>
          <Path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" {...p} />
          <Circle cx={12} cy={10} r={2.3} {...p} />
        </>
      )}
    </Svg>
  );
}

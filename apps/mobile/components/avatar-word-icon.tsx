import type { AvatarWordIconNode } from "@atlas/core";
import { contrastRatio } from "@atlas/core";
import { Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

/** A named picture, drawn in a 24-unit box with the bot's color. */
export function AvatarWordIcon({
  nodes,
  color,
}: {
  nodes: readonly AvatarWordIconNode[];
  color: string;
}) {
  const ink = contrastRatio(color, "#FFFFFF") < 1.15 ? "#141414" : color;
  const stroke = {
    fill: "none" as const,
    stroke: ink,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <G>
      {nodes.map((node, index) => {
        const key = `${node[0]}-${index}`;
        switch (node[0]) {
          case "path":
            return <Path key={key} d={node[1]} {...stroke} />;
          case "circle":
            return <Circle key={key} cx={node[1]} cy={node[2]} r={node[3]} {...stroke} />;
          case "ellipse":
            return (
              <Ellipse key={key} cx={node[1]} cy={node[2]} rx={node[3]} ry={node[4]} {...stroke} />
            );
          case "line":
            return (
              <Line key={key} x1={node[1]} y1={node[2]} x2={node[3]} y2={node[4]} {...stroke} />
            );
          case "rect":
            return (
              <Rect
                key={key}
                x={node[1]}
                y={node[2]}
                width={node[3]}
                height={node[4]}
                rx={node[5]}
                {...stroke}
              />
            );
          case "polyline":
            return <Polyline key={key} points={node[1]} {...stroke} />;
          case "polygon":
            return <Polygon key={key} points={node[1]} {...stroke} />;
          default:
            return null;
        }
      })}
    </G>
  );
}

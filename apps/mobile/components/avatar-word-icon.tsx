import type { AvatarWordIconNode } from "@atlas/core";
import {
  AVATAR_WORD_ICON_TRANSFORM,
  avatarWordIcon,
  avatarWordInk,
  avatarWordLetter,
  contrastRatio,
} from "@atlas/core";
import { Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect, Text } from "react-native-svg";

const stroke = (ink: string) => ({
  fill: "none" as const,
  stroke: ink,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

/** A filled disc in the bot color, with the word's picture or its letter. */
export function AvatarWordIcon({ word, color }: { word: string; color: string }) {
  const ink = avatarWordInk(color);
  const pale = contrastRatio(color, "#FFFFFF") < 1.15;
  const nodes = avatarWordIcon(word);
  const pen = stroke(ink);
  return (
    <G>
      <Circle
        cx={12}
        cy={12}
        r={11}
        fill={color}
        stroke={pale ? "rgba(20,20,20,0.28)" : "none"}
        strokeWidth={pale ? 0.6 : 0}
      />
      {nodes ? (
        <G transform={AVATAR_WORD_ICON_TRANSFORM}>
          {nodes.map((node, index) => drawNode(node, `${node[0]}-${index}`, pen))}
        </G>
      ) : (
        <Text
          x={12}
          y={12.5}
          fill={ink}
          stroke="none"
          textAnchor="middle"
          alignmentBaseline="central"
          fontSize={10}
          fontWeight="700"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {avatarWordLetter(word)}
        </Text>
      )}
    </G>
  );
}

function drawNode(node: AvatarWordIconNode, key: string, pen: ReturnType<typeof stroke>) {
  switch (node[0]) {
    case "path":
      return <Path key={key} d={node[1]} {...pen} />;
    case "circle":
      return <Circle key={key} cx={node[1]} cy={node[2]} r={node[3]} {...pen} />;
    case "ellipse":
      return <Ellipse key={key} cx={node[1]} cy={node[2]} rx={node[3]} ry={node[4]} {...pen} />;
    case "line":
      return <Line key={key} x1={node[1]} y1={node[2]} x2={node[3]} y2={node[4]} {...pen} />;
    case "rect":
      return (
        <Rect
          key={key}
          x={node[1]}
          y={node[2]}
          width={node[3]}
          height={node[4]}
          rx={node[5]}
          {...pen}
        />
      );
    case "polyline":
      return <Polyline key={key} points={node[1]} {...pen} />;
    case "polygon":
      return <Polygon key={key} points={node[1]} {...pen} />;
    default:
      return null;
  }
}

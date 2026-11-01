import {
  LOGO_BODY_PATH,
  LOGO_SNOW_PATH,
  LOGO_AVATAR_LIGHTING as lighting,
  logoAvatarPaint,
} from "@atlas/core";
import { memo } from "react";

/** Mountain body for the Atlas avatar set. Snow uses the same ink as the eyes. */
export const LogoAvatarBody = memo(function LogoAvatarBody({
  id,
  color,
  originalOrange,
  mark,
}: {
  id: string;
  color: string;
  originalOrange: boolean;
  mark: string;
}) {
  const paint = logoAvatarPaint(color, originalOrange);
  return (
    <g className="logo-avatar-art">
      <defs>
        <radialGradient id={`body-fill-${id}`} {...lighting.body}>
          <stop stopColor={paint.base} />
          <stop offset=".55" stopColor={paint.base} />
          <stop offset="1" stopColor={paint.edge} />
        </radialGradient>
        <radialGradient id={`body-shade-${id}`} {...lighting.flank}>
          <stop stopColor={paint.flank} stopOpacity=".55" />
          <stop offset=".45" stopColor={paint.flank} stopOpacity=".28" />
          <stop offset="1" stopColor={paint.flank} stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id={`body-light-${id}`}
          gradientUnits={lighting.crown.gradientUnits}
          cx={lighting.crown.cx}
          cy={lighting.crown.cy}
          r={lighting.crown.r}
          gradientTransform={lighting.crown.gradientTransform}
        >
          <stop stopColor="white" stopOpacity={lighting.crown.peak} />
          <stop offset=".45" stopColor="white" stopOpacity={lighting.crown.shoulder} />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={LOGO_BODY_PATH} fill={`url(#body-fill-${id})`} />
      <path d={LOGO_BODY_PATH} fill={`url(#body-shade-${id})`} />
      <path d={LOGO_BODY_PATH} fill={`url(#body-light-${id})`} />
      <path d={LOGO_SNOW_PATH} fill={mark} />
    </g>
  );
});

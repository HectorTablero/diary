import {
  APP_LOGO_PATHS,
  BRAND_LOGO_PATHS,
  LOGO_COLOR,
  LOGO_STROKE_WIDTH,
  LOGO_VIEWBOX,
} from '@diary/shared';
import { cn } from '@/lib/utils';

interface AnimatedLogoProps {
  strokeColor?: string;
  className?: string;
  onClick?: () => void;
}

export function AnimatedLogo({ strokeColor = LOGO_COLOR, className, onClick }: AnimatedLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={LOGO_VIEWBOX}
      className={cn('w-full cursor-pointer', className)}
      onClick={onClick}
    >
      <style>{`
        .animated-d-path {
          fill: none;
          stroke: ${strokeColor};
          stroke-width: ${LOGO_STROKE_WIDTH}px;
          stroke-linecap: round;
          stroke-linejoin: round;
          transition: d 0.6s cubic-bezier(0.25, 1, 0.5, 1);
        }
        .vertical-bar { d: path("${APP_LOGO_PATHS[0].d}"); }
        .chevron      { d: path("${APP_LOGO_PATHS[1].d}"); }
        .horiz-line   { d: path("${APP_LOGO_PATHS[2].d}"); }
        svg:hover .vertical-bar { d: path("${BRAND_LOGO_PATHS[2].d}"); }
        svg:hover .chevron      { d: path("${BRAND_LOGO_PATHS[1].d}"); }
        svg:hover .horiz-line   { d: path("${BRAND_LOGO_PATHS[0].d}"); }
      `}</style>
      <g>
        <path className="animated-d-path horiz-line" />
        <path className="animated-d-path chevron" />
        <path className="animated-d-path vertical-bar" />
      </g>
    </svg>
  );
}
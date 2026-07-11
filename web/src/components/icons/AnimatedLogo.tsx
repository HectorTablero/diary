import { cn } from '@/lib/utils';

interface AnimatedLogoProps {
  strokeColor?: string;
  className?: string;
  onClick?: () => void;
}

export function AnimatedLogo({ strokeColor = "rgb(0, 114, 255)", className, onClick }: AnimatedLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 500 500"
      className={cn('w-full cursor-pointer', className)}
      onClick={onClick}
    >
      <style>{`
        .animated-d-path {
          fill: none;
          stroke: ${strokeColor};
          stroke-width: 50px;
          stroke-linecap: round;
          stroke-linejoin: round;
          transition: d 0.6s cubic-bezier(0.25, 1, 0.5, 1);
        }
        .vertical-bar { d: path("M 100 100 L 100 400"); }
        .chevron      { d: path("M 175 100 L 400 250 L 175 400"); }
        .horiz-line   { d: path("M 200 250 L 100 250"); }
        svg:hover .vertical-bar { d: path("M 450 100 L 450 400"); }
        svg:hover .chevron      { d: path("M 300 125 L 375 250 L 300 375"); }
        svg:hover .horiz-line   { d: path("M 375 250 L 50 250"); }
      `}</style>
      <g>
        <path className="animated-d-path horiz-line" />
        <path className="animated-d-path chevron" />
        <path className="animated-d-path vertical-bar" />
      </g>
    </svg>
  );
}
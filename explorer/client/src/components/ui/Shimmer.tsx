interface ShimmerProps {
  width?: string | number;
  height?: string | number;
  circle?: boolean;
  className?: string;
  count?: number;
}

export function Shimmer({ width = '100%', height = 14, circle, className = '', count = 1 }: ShimmerProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`shimmer ${circle ? 'shimmer--circle' : ''} ${className}`}
          style={{
            width: circle ? height : width,
            height,
            marginBottom: count > 1 ? 8 : 0,
          }}
        />
      ))}
    </>
  );
}

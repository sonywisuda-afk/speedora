import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface AnalyticsCardProps {
  title: string;
  // Right-aligned slot next to the title - a granularity toggle, date
  // filter, etc. Optional so a plain title-only card (most of them) doesn't
  // need an empty prop.
  controls?: ReactNode;
  className?: string;
  children: ReactNode;
}

// Sprint 6C.5 (Analytics UI Foundation) - the "Card > CardHeader > CardTitle
// (text-base) > CardContent" shell every analytics panel on /analytics and
// /videos/:id/performance already hand-writes identically. Not a new
// visual language - just names the existing pattern so new panels (6D
// Leaderboard, 6E Heatmap, ...) stop re-typing it. Deliberately thin: no
// variant system, no size prop - callers needing something different just
// use Card/CardHeader/CardContent directly, same as today.
export function AnalyticsCard({ title, controls, className, children }: AnalyticsCardProps) {
  return (
    <Card className={className}>
      <CardHeader className={cn(controls && 'flex-row items-center justify-between space-y-0')}>
        <CardTitle className="text-base">{title}</CardTitle>
        {controls}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

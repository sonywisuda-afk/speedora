import { Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface UnavailableMetricAction {
  label: string;
  href: string;
}

export interface UnavailableMetricProps {
  label: string;
  reason: string;
  // 'tile' matches StatTile's Card shape for dropping into a stat grid;
  // 'inline' is a compact single-line note for embedding inside a table
  // cell or chart panel that already has its own chrome.
  variant?: 'tile' | 'inline';
  // Set when the gap is fixable by the user (e.g. TikTok follower count
  // needing a reconnect) rather than a hard platform limitation - renders a
  // CTA instead of just an explanation.
  action?: UnavailableMetricAction;
  className?: string;
}

// Sprint 6A (Analytics Dashboard Expansion) - the canonical "this metric has
// no real data source" state, used everywhere a platform genuinely can't
// supply a number (TikTok watch time, LinkedIn followers, retention/
// drop-off/replay, etc. - see platform-capability.util.ts). Always shows the
// *why*, never a bare dash or a fabricated number - see CLAUDE.md's
// Product Experience mandate and this initiative's "no fabricated KPIs"
// rule.
export function UnavailableMetric({
  label,
  reason,
  variant = 'tile',
  action,
  className,
}: UnavailableMetricProps) {
  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{reason}</span>
        {action ? (
          <a href={action.href} className="text-signal-cyan underline underline-offset-2">
            {action.label}
          </a>
        ) : null}
      </span>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 flex items-center gap-1.5 font-display text-2xl text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          Not available
        </p>
        <p className="mt-1 font-body text-xs text-muted-foreground">{reason}</p>
        {action ? (
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href={action.href}>{action.label}</a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
